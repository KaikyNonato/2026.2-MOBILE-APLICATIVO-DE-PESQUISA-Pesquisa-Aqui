import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { listSendQueue } from './collectionStore';
import { getCachedResearches, type Research } from './researchCache';
import { computeProgress } from './researchProgress';
import { listSent } from './sentHistory';

// Avisos do aparelho (notificações locais). Nenhum servidor envia nada: o próprio app confere a lista de pesquisas
// que já está no aparelho, depois de cada atualização (ao abrir, ao pegar rede e na sincronização em segundo plano),
// e avisa de três coisas:
// - uma pesquisa nova vinculada ao pesquisador;
// - uma pesquisa encerrada;
// - uma meta ainda não atingida perto do prazo (um aviso 24 h antes do fim).
// Por isso o aviso chega quando o app atualiza, não no instante em que o administrador age.

const CHANNEL_ID = 'pesquisas';
const ENABLED_KEY = 'notifications_enabled'; // '0' = desligado; qualquer outra coisa (ou nada) = ligado
const SEEN_KEY = 'notifications_seen';
const FIRED_KEY = 'notifications_fired';

const HOUR_MS = 60 * 60 * 1000;
/** A partir de quanto tempo antes do fim o aviso de meta é dado. */
const DEADLINE_WINDOW_MS = 24 * HOUR_MS;
/** Só agenda avisos de prazo para pesquisas que terminam nesta janela (não precisa agendar para daqui a meses). */
const SCHEDULE_HORIZON_MS = 7 * 24 * HOUR_MS;

const isWeb = Platform.OS === 'web';

/** O canal do Android foi criado? Em lugares sem suporte (Expo Go) a criação falha: aí os avisos usam o canal padrão. */
let channelReady = false;
const channelOptions = () => (Platform.OS === 'android' && channelReady ? { channelId: CHANNEL_ID } : {});

interface SeenState {
    ids: number[];
    closed: number[];
}

// ---------- Configuração ----------

/** Como o aviso aparece com o app aberto e, no Android, o canal das notificações. Chamar uma vez ao abrir o app. */
export async function configureNotifications(): Promise<void> {
    if (isWeb) return;
    try {
        Notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowBanner: true,
                shouldShowList: true,
                shouldPlaySound: false,
                shouldSetBadge: false,
            }),
        });
    } catch (error) {
        console.log('Não foi possível configurar as notificações:', error);
        return;
    }
    if (Platform.OS === 'android') {
        try {
            await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
                name: 'Pesquisas',
                description: 'Pesquisa nova, meta perto do prazo e pesquisa encerrada',
                importance: AndroidImportance.DEFAULT,
            });
            channelReady = true;
        } catch (error) {
            // Expo Go não cria canais: os avisos seguem pelo canal padrão. Em um build próprio isso não acontece.
            console.log('Canal de notificações indisponível, usando o padrão:', error);
        }
    }
}

async function hasPermission(): Promise<boolean> {
    try {
        return (await Notifications.getPermissionsAsync()).granted;
    } catch {
        return false;
    }
}

/** Pede a permissão do sistema (no Android 13+ e no iOS aparece uma janela). Devolve se foi concedida. */
export async function requestNotificationPermission(): Promise<boolean> {
    if (isWeb) return false;
    try {
        if (await hasPermission()) return true;
        return (await Notifications.requestPermissionsAsync()).granted;
    } catch {
        return false;
    }
}

/** A pessoa ainda não foi perguntada (o sistema ainda não decidiu)? */
async function permissionUndetermined(): Promise<boolean> {
    try {
        const permission = await Notifications.getPermissionsAsync();
        return !permission.granted && permission.canAskAgain && permission.status === 'undetermined';
    } catch {
        return false;
    }
}

/** Preferência do app (interruptor do Perfil) e permissão do sistema, juntas. */
export async function areNotificationsEnabled(): Promise<boolean> {
    if (isWeb) return false;
    const preference = await AsyncStorage.getItem(ENABLED_KEY);
    return preference !== '0' && (await hasPermission());
}

/** Liga ou desliga. Para ligar é preciso a permissão do sistema; devolve se ficou no estado pedido. */
export async function setNotificationsEnabled(enabled: boolean): Promise<boolean> {
    if (isWeb) return false;
    if (enabled) {
        if (!(await requestNotificationPermission())) return false;
        await AsyncStorage.setItem(ENABLED_KEY, '1');
        await reconcileNotifications({ silent: true });
        return true;
    }
    await AsyncStorage.setItem(ENABLED_KEY, '0');
    await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
    return true;
}

/** Primeira abertura depois do login: pergunta a permissão uma vez, a menos que a pessoa já tenha desligado os avisos. */
export async function askPermissionOnce(): Promise<void> {
    if (isWeb) return;
    if ((await AsyncStorage.getItem(ENABLED_KEY)) === '0') return;
    if (await permissionUndetermined()) await requestNotificationPermission();
}

/** Ao sair da conta: cancela o que estava agendado e esquece o que já foi avisado (a próxima pessoa começa do zero). */
export async function clearNotificationState(): Promise<void> {
    if (isWeb) return;
    await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
    await AsyncStorage.multiRemove([SEEN_KEY, FIRED_KEY, ENABLED_KEY]).catch(() => undefined);
}

// ---------- Envio dos avisos ----------

async function notifyNow(title: string, body: string): Promise<void> {
    await Notifications.scheduleNotificationAsync({
        content: { title, body, data: { screen: 'pesquisas' } },
        trigger: Platform.OS === 'android' && channelReady ? { channelId: CHANNEL_ID } : null,
    });
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
    try {
        const raw = await AsyncStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function hoursLeftText(msLeft: number): string {
    if (msLeft < HOUR_MS) return 'menos de 1 hora';
    const hours = Math.floor(msLeft / HOUR_MS);
    return plural(hours, 'hora', 'horas');
}

// ---------- Conferência ----------

/**
 * Compara a lista de pesquisas do aparelho com o que já foi avisado e dispara o que for novo.
 * `silent`: só atualiza o que já foi visto, sem avisar (usado quando a pessoa está olhando a lista na tela).
 * Pode ser chamada quantas vezes quiser: não repete aviso.
 */
export async function reconcileNotifications({ silent = false }: { silent?: boolean } = {}): Promise<void> {
    if (isWeb) return;
    try {
        if ((await AsyncStorage.getItem(ENABLED_KEY)) === '0') return;
        const permitted = await hasPermission();
        const canNotify = !silent && permitted;

        const researches = (await getCachedResearches()).filter((r) => !r.revoked);
        const seen = await readJson<SeenState | null>(SEEN_KEY, null);

        // Primeira conferência desta conta: o que já existe vira o ponto de partida, sem avisar de tudo de uma vez.
        if (!seen) console.log('[avisos] primeira conferência desta conta: só marca o que já existe, sem avisar.');
        if (seen) {
            const known = new Set(seen.ids);
            const knownClosed = new Set(seen.closed);

            const fresh = researches.filter((r) => !known.has(r.id) && r.status !== 'CLOSED');
            const justClosed = researches.filter((r) => r.status === 'CLOSED' && known.has(r.id) && !knownClosed.has(r.id));

            console.log(
                `[avisos] pesquisas no aparelho: ${researches.length} | novas: ${fresh.length} | encerradas agora: ${justClosed.length} | silencioso: ${silent} | permissão: ${permitted}`,
            );
            if (canNotify) {
                if (fresh.length === 1) {
                    await notifyNow('Nova pesquisa vinculada a você', fresh[0].title);
                } else if (fresh.length > 1) {
                    await notifyNow(`${fresh.length} novas pesquisas vinculadas a você`, fresh.map((r) => r.title).join(', '));
                }
                for (const research of justClosed) {
                    await notifyNow('Pesquisa encerrada', `"${research.title}" foi encerrada. Envie as coletas que ainda estão no aparelho.`);
                }
            }
        }

        await AsyncStorage.setItem(
            SEEN_KEY,
            JSON.stringify({ ids: researches.map((r) => r.id), closed: researches.filter((r) => r.status === 'CLOSED').map((r) => r.id) } satisfies SeenState),
        );

        // Silencioso ainda agenda os avisos futuros de prazo, só não dispara nada agora.
        await reconcileDeadlines(researches, { schedule: permitted, immediate: canNotify });
    } catch (error) {
        console.log('Falha ao conferir notificações:', error);
    }
}

/** Aviso de meta perto do prazo: agendado para 24 h antes do fim; se já está dentro das 24 h, avisa uma vez agora. */
async function reconcileDeadlines(researches: Research[], allowed: { schedule: boolean; immediate: boolean }): Promise<void> {
    const [sent, queue, fired] = await Promise.all([
        listSent().catch(() => []),
        listSendQueue().catch(() => []),
        readJson<string[]>(FIRED_KEY, []),
    ]);
    const firedSet = new Set(fired);
    const now = Date.now();
    let firedChanged = false;

    for (const research of researches) {
        const identifier = `deadline-${research.id}`;
        // O agendamento é refeito a cada conferência, com o número de coletas que faltam hoje.
        await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined);

        const target = research.targetCount ?? null;
        const end = Date.parse(research.endDate);
        if (!target || !Number.isFinite(end) || research.status === 'CLOSED' || end <= now) continue;

        const pendingIds = queue.filter((c) => c.researchId === research.id).map((c) => c.clientId);
        const progress = computeProgress(research, sent, pendingIds);
        if (progress.remaining === null || progress.remaining <= 0) continue; // meta cumprida: nada a avisar
        if (end - now > SCHEDULE_HORIZON_MS) continue;

        const body = (when: string) =>
            `Faltam ${plural(progress.remaining!, 'coleta', 'coletas')} para a meta de "${research.title}". ${when}`;
        const windowStart = end - DEADLINE_WINDOW_MS;

        if (now < windowStart) {
            if (!allowed.schedule) continue;
            await Notifications.scheduleNotificationAsync({
                identifier,
                content: { title: 'Meta perto do prazo', body: body('O prazo termina em 24 horas.'), data: { screen: 'pesquisas' } },
                trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: windowStart, ...channelOptions() },
            });
        } else {
            const key = `${research.id}:${research.endDate}`;
            if (firedSet.has(key) || !allowed.immediate) continue;
            await notifyNow('Meta perto do prazo', body(`O prazo termina em ${hoursLeftText(end - now)}.`));
            firedSet.add(key);
            firedChanged = true;
        }
    }

    if (firedChanged) await AsyncStorage.setItem(FIRED_KEY, JSON.stringify([...firedSet].slice(-200)));
}

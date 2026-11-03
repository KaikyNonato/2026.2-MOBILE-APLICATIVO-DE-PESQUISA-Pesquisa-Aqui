// mobile/app/(app)/sincronizacao/index.tsx
import { useFocusEffect } from 'expo-router';
import { Check, CloudUpload, HardDrive, Trash2, WifiOff } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, {
    Easing,
    FadeInDown,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';
import ResearchProgressCard from './_components/ResearchProgressCard';
import SyncCard, { type SyncCardStatus } from './_components/SyncCard';
import { canDiscard, discardCollection } from '@/lib/collectionDiscard';
import { listCollections, type LocalCollection } from '@/lib/collectionStore';
import { getStorageReport, releaseConfirmedFiles, type StorageReport } from '@/lib/confirmedFiles';
import { buildSpaceWarning, spaceLevel } from '@/lib/deviceSpace';
import { formatBytes } from '@/lib/photoStorage';
import { getCachedResearches, type Research } from '@/lib/researchCache';
import { computeProgress } from '@/lib/researchProgress';
import { listSent, type SentRecord } from '@/lib/sentHistory';
import { syncQueue } from '@/lib/syncQueue';
import Chip from '@/components/Chip';
import Contour from '@/components/Contour';
import ActionCard from '@/components/home/ActionCard';
import CountUp from '@/components/home/CountUp';
import PressableScale from '@/components/home/PressableScale';
import ProgressBar from '@/components/home/ProgressBar';
import { Brand, Radius, TAB_BAR_CLEARANCE } from '@/constants/brand';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useRemoveResearch } from '@/hooks/useRemoveResearch';
import { useSyncState } from '@/hooks/useSyncQueue';

const EMPTY_USAGE: StorageReport = { photosBytes: 0, audioBytes: 0, totalBytes: 0, freeBytes: null, releasableBytes: 0 };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

type HistoryTab = 'enviadas' | 'pendentes' | 'falhas';

type HistoryRow = { kind: 'sent'; record: SentRecord } | { kind: 'queue'; item: LocalCollection };

const EMPTY_TEXT: Record<HistoryTab, string> = {
    enviadas: 'As coletas que o servidor confirmar aparecem aqui.',
    pendentes: 'Nenhuma coleta finalizada aguardando envio.',
    falhas: 'Nenhuma coleta com falha. Tudo certo por aqui.',
};

/** Entrada escalonada, igual à da Home. */
const enter = (index: number) =>
    FadeInDown.delay(120 + Math.min(index, 8) * 70)
        .duration(480)
        .easing(Easing.out(Easing.cubic));

function SectionHeader({ title, right }: { title: string; right?: string }) {
    return (
        <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {right ? <Text style={styles.sectionRight}>{right}</Text> : null}
        </View>
    );
}

function HeroStat({ value, label, alert }: { value: number; label: string; alert?: boolean }) {
    return (
        <View style={styles.stat}>
            <CountUp value={value} style={[styles.statValue, alert && styles.statValueAlert]} />
            <Text style={styles.statLabel}>{label}</Text>
        </View>
    );
}

export default function Sincronizacao() {
    const [collections, setCollections] = useState<LocalCollection[]>([]);
    const [researches, setResearches] = useState<Research[]>([]);
    const [sent, setSent] = useState<SentRecord[]>([]);
    const [tab, setTab] = useState<HistoryTab>('pendentes');
    const [usage, setUsage] = useState<StorageReport>(EMPTY_USAGE);
    const [refreshing, setRefreshing] = useState(false);
    const [released, setReleased] = useState<string | null>(null);
    const isOnline = useNetworkStatus();
    const sync = useSyncState();

    // As curvas de nível "respiram" devagar, como na Home.
    const breathe = useSharedValue(0);
    // Quem pediu menos movimento no aparelho não vê a animação.
    const reduceMotion = useReducedMotion();
    useEffect(() => {
        if (reduceMotion) return;
        breathe.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }), -1, true);
    }, [breathe, reduceMotion]);
    const contourStyle = useAnimatedStyle(() => ({
        transform: [{ scale: 1 + breathe.value * 0.07 }, { translateX: breathe.value * -6 }],
    }));

    // Tudo vem do aparelho: a tela funciona sem internet
    const load = useCallback(async () => {
        const [stored, cached, sentRecords] = await Promise.all([listCollections(), getCachedResearches(), listSent()]);
        setCollections(stored);
        setResearches(cached);
        setSent(sentRecords);
        setUsage(getStorageReport(stored));
    }, []);

    // Remover a pesquisa do aparelho (bloqueado com coleta pendente, com confirmação e aviso ao servidor)
    const removeResearch = useRemoveResearch(isOnline, load);

    // Recarrega ao abrir a aba e a cada mudança do envio (coleta confirmada sai, falha ganha motivo),
    // para a lista acompanhar o envio em tempo real. Ao sair da aba, deixa de acompanhar.
    useFocusEffect(
        useCallback(() => {
            const reload = () => void load().catch((error) => console.log('Falha ao ler as coletas do aparelho:', error));
            reload();
            return syncQueue.subscribe(reload);
        }, [load]),
    );

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            await load();
        } catch (error) {
            console.log('Falha ao atualizar a fila:', error);
        } finally {
            setRefreshing(false);
        }
    };

    // Libera o espaço do que o servidor já confirmou. Nunca toca no que ainda não foi enviado.
    const freeSpace = () => {
        const { files, freedBytes } = releaseConfirmedFiles(collections);
        setReleased(files > 0 ? `${plural(files, 'arquivo apagado', 'arquivos apagados')}: ${formatBytes(freedBytes)} liberados.` : null);
        void load().catch((error) => console.log('Falha ao atualizar o espaço:', error));
    };

    // Coleta que o servidor recusou de vez: só sai do aparelho se o pesquisador descartar, depois de confirmar.
    const confirmDiscard = (item: LocalCollection) => {
        Alert.alert(
            'Descartar esta coleta?',
            `As respostas, fotos e áudios da coleta ${item.clientId.slice(0, 8)} serão apagados deste aparelho e NÃO serão enviados ao servidor. ` +
                `Motivo da recusa: ${item.sendState?.lastFailure?.reason ?? 'o servidor não aceitou esta coleta'} ` +
                'Isso não pode ser desfeito.',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Descartar',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await discardCollection(item.clientId);
                        } catch (error) {
                            Alert.alert('Não foi possível descartar', error instanceof Error ? error.message : 'Tente de novo.');
                        }
                        void load().catch((error) => console.log('Falha ao atualizar a lista:', error));
                    },
                },
            ],
        );
    };

    const level = spaceLevel(usage.freeBytes);
    const spaceWarning = buildSpaceWarning(level, usage.freeBytes === null ? '' : formatBytes(usage.freeBytes), usage.releasableBytes);

    const finished = collections
        .filter((c) => c.status === 'FINISHED')
        // a mais antiga primeiro: é a ordem em que o envio as leva
        .sort((a, b) => (a.finishedAt ?? a.startedAt).localeCompare(b.finishedAt ?? b.startedAt));
    const drafts = collections.length - finished.length;

    // O histórico em três: enviadas (já no servidor), pendentes (aguardando) e falhas (com o motivo)
    const failed = finished.filter((c) => !!c.sendState?.lastFailure);
    const pending = finished.filter((c) => !c.sendState?.lastFailure);
    const titles = new Map(researches.map((research) => [research.id, research.title]));
    const titleOf = (researchId: number) => titles.get(researchId) ?? `Pesquisa ${researchId}`;
    const formatDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR');

    const rows: HistoryRow[] =
        tab === 'enviadas'
            ? sent.map((record) => ({ kind: 'sent' as const, record }))
            : (tab === 'falhas' ? failed : pending).map((item) => ({ kind: 'queue' as const, item }));

    const tabs: { key: HistoryTab; label: string; count: number }[] = [
        { key: 'enviadas', label: 'Enviadas', count: sent.length },
        { key: 'pendentes', label: 'Pendentes', count: pending.length },
        { key: 'falhas', label: 'Falhas', count: failed.length },
    ];

    // Pesquisas com meta, no aparelho ou já com coleta feita
    const progressOf = (research: Research) =>
        computeProgress(
            research,
            sent,
            finished.filter((c) => c.researchId === research.id).map((c) => c.clientId),
        );
    const draftsOf = (researchId: number) =>
        collections.filter((c) => c.researchId === researchId && c.status === 'IN_PROGRESS').length;
    const shownResearches = researches.filter(
        (research) => research.isDownloaded || progressOf(research).done > 0 || research.targetCount != null,
    );

    const subtitle =
        collections.length === 0
            ? 'Nenhuma coleta pendente'
            : `${plural(finished.length, 'coleta aguardando envio', 'coletas aguardando envio')}` +
              (drafts > 0 ? `, ${plural(drafts, 'rascunho', 'rascunhos')}` : '');

    // ---------- Envio ----------

    const canSend = isOnline && !sync.running && finished.length > 0;
    const sendNow = () => void syncQueue.run({ trigger: 'manual' });

    const buttonLabel = sync.running
        ? `Enviando ${Math.min(sync.done + 1, sync.total)} de ${sync.total}…`
        : finished.length > 0
          ? `Enviar agora (${finished.length})`
          : 'Enviar agora';

    const lastRun = sync.lastRun;
    let resultNote: { text: string; warning: boolean } | null = null;
    if (!sync.running && lastRun) {
        if (lastRun.stopReason) {
            resultNote = { text: `Envio interrompido: ${lastRun.stopReason}`, warning: true };
        } else if (lastRun.confirmed > 0 || lastRun.failed > 0) {
            const parts: string[] = [];
            if (lastRun.confirmed > 0) parts.push(plural(lastRun.confirmed, 'coleta enviada', 'coletas enviadas'));
            if (lastRun.failed > 0) parts.push(plural(lastRun.failed, 'com falha', 'com falha'));
            resultNote = { text: parts.join(', '), warning: lastRun.failed > 0 };
        }
    }

    const statusOf = (item: LocalCollection): SyncCardStatus => {
        const inRun = sync.items[item.clientId];
        if (inRun === 'sending') return 'enviando';
        if (inRun === 'waiting') return 'aguardando';
        return item.sendState?.lastFailure ? 'falha' : 'pendente';
    };

    return (
        <FlatList
            style={styles.container}
            data={rows}
            keyExtractor={(row) => (row.kind === 'sent' ? row.record.clientId : row.item.clientId)}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Brand.green} />}
            ListHeaderComponent={
                <View>
                    <View style={styles.hero}>
                        <Animated.View style={[StyleSheet.absoluteFill, contourStyle]} pointerEvents="none">
                            <Contour seed={5.3} rings={10} cx={0.85} cy={0.35} size={1} opacity={0.8} color={Brand.green} />
                        </Animated.View>
                        <View style={styles.heroRow}>
                            <Text style={styles.title} accessibilityRole="header">
                                Envio de coletas
                            </Text>
                            <Chip label={isOnline ? 'Online' : 'Offline'} tone={isOnline ? 'dark' : 'clay'} />
                        </View>
                        <Text style={styles.subtitle}>{subtitle}</Text>

                        <Animated.View entering={enter(0)} style={styles.strip}>
                            <HeroStat value={pending.length} label={pending.length === 1 ? 'pendente' : 'pendentes'} />
                            <View style={styles.stripDivider} />
                            <HeroStat value={sent.length} label={sent.length === 1 ? 'enviada' : 'enviadas'} />
                            <View style={styles.stripDivider} />
                            <HeroStat value={failed.length} label={failed.length === 1 ? 'falha' : 'falhas'} alert={failed.length > 0} />
                        </Animated.View>
                    </View>

                    <View style={styles.headerBody}>
                        <Animated.View entering={enter(1)}>
                            <PressableScale
                                onPress={sendNow}
                                disabled={!canSend}
                                accessibilityRole="button"
                                accessibilityLabel="Enviar agora as coletas finalizadas"
                                accessibilityState={{ disabled: !canSend, busy: sync.running }}
                                style={[styles.sendButton, !canSend && !sync.running && styles.sendButtonDisabled]}
                            >
                                {sync.running ? <ActivityIndicator size="small" color="#fff" /> : <CloudUpload size={20} color="#fff" strokeWidth={1.8} />}
                                <Text style={styles.sendButtonText}>{buttonLabel}</Text>
                            </PressableScale>
                        </Animated.View>

                        {sync.running && sync.total > 0 ? (
                            <View
                                style={styles.runProgress}
                                accessibilityRole="progressbar"
                                accessibilityValue={{ min: 0, max: sync.total, now: sync.done }}
                            >
                                <ProgressBar percent={(sync.done / sync.total) * 100} height={6} />
                            </View>
                        ) : null}

                        {!isOnline && finished.length > 0 ? (
                            <View style={styles.noteWrap}>
                                <ActionCard
                                    tone="clay"
                                    icon={<WifiOff size={22} color={Brand.clayInk} strokeWidth={1.8} />}
                                    title="Sem conexão"
                                    text="O envio começa sozinho quando o sinal voltar."
                                />
                            </View>
                        ) : resultNote ? (
                            <View style={[styles.resultPill, resultNote.warning && styles.resultPillWarning]}>
                                {resultNote.warning ? null : <Check size={14} color={Brand.greenDeep} strokeWidth={2.2} />}
                                <Text style={[styles.resultNote, resultNote.warning && styles.resultNoteWarning]}>
                                    {resultNote.text}
                                </Text>
                            </View>
                        ) : null}

                        <Animated.View entering={enter(2)} style={styles.storageCard} accessibilityRole="summary">
                            <View style={styles.storageTop}>
                                <View style={styles.storageIcon}>
                                    <HardDrive size={18} color={Brand.greenDeep} strokeWidth={1.8} />
                                </View>
                                <Text style={styles.storageLabel}>Espaço ocupado pelas coletas pendentes</Text>
                            </View>
                            <Text style={styles.storageTotal}>{formatBytes(usage.totalBytes)}</Text>

                            <View style={styles.splitBar}>
                                {usage.totalBytes > 0 ? (
                                    <>
                                        <View style={[styles.splitPhotos, { flex: Math.max(usage.photosBytes, 1) }]} />
                                        <View style={[styles.splitAudio, { flex: Math.max(usage.audioBytes, 1) }]} />
                                    </>
                                ) : null}
                            </View>
                            <View style={styles.legend}>
                                <View style={styles.legendItem}>
                                    <View style={[styles.legendDot, { backgroundColor: Brand.green }]} />
                                    <Text style={styles.storageDetail}>Fotos {formatBytes(usage.photosBytes)}</Text>
                                </View>
                                <View style={styles.legendItem}>
                                    <View style={[styles.legendDot, { backgroundColor: Brand.mint }]} />
                                    <Text style={styles.storageDetail}>Áudio {formatBytes(usage.audioBytes)}</Text>
                                </View>
                                {usage.freeBytes !== null ? (
                                    <Text style={[styles.storageDetail, styles.legendFree]}>Livre: {formatBytes(usage.freeBytes)}</Text>
                                ) : null}
                            </View>
                            {drafts > 0 ? <Text style={styles.storageNote}>Inclui os rascunhos em andamento.</Text> : null}

                            {spaceWarning ? (
                                <Text style={[styles.spaceWarning, spaceWarning.level === 'critical' && styles.spaceWarningCritical]}>
                                    {spaceWarning.title}. {spaceWarning.text}
                                </Text>
                            ) : null}

                            {usage.releasableBytes > 0 ? (
                                <View style={styles.releaseBox}>
                                    <Text style={styles.storageDetail}>
                                        {formatBytes(usage.releasableBytes)} já estão no servidor e ainda ocupam o aparelho.
                                    </Text>
                                    <PressableScale
                                        onPress={freeSpace}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Apagar do aparelho os arquivos já enviados, ${formatBytes(usage.releasableBytes)}`}
                                        style={styles.releaseButton}
                                    >
                                        <Trash2 size={14} color={Brand.greenDeep} strokeWidth={1.8} />
                                        <Text style={styles.releaseText}>Apagar arquivos já enviados</Text>
                                    </PressableScale>
                                </View>
                            ) : released ? (
                                <Text style={styles.storageNote}>{released}</Text>
                            ) : null}
                        </Animated.View>

                        {shownResearches.length > 0 ? (
                            <Animated.View entering={enter(3)} style={styles.section}>
                                <SectionHeader
                                    title="Progresso e pesquisas no aparelho"
                                />
                                {shownResearches.map((research, index) => {
                                    const inDevice = collections.filter((c) => c.researchId === research.id).length > 0;
                                    return (
                                        <ResearchProgressCard
                                            key={research.id}
                                            titulo={research.title}
                                            isDownloaded={!!research.isDownloaded}
                                            progress={progressOf(research)}
                                            drafts={draftsOf(research.id)}
                                            delay={300 + index * 90}
                                            onRemove={research.isDownloaded ? () => void removeResearch(research.id, research.title) : undefined}
                                            removeBlocked={inDevice}
                                        />
                                    );
                                })}
                            </Animated.View>
                        ) : null}

                        <Animated.View entering={enter(4)} style={styles.sectionTight}>
                            <SectionHeader title="Histórico de envio" right={plural(sent.length + finished.length, 'coleta', 'coletas')} />
                            <View style={styles.tabs} accessibilityRole="tablist">
                                {tabs.map(({ key, label, count }) => {
                                    const active = tab === key;
                                    const alert = key === 'falhas' && count > 0 && !active;
                                    return (
                                        <PressableScale
                                            key={key}
                                            containerStyle={styles.tabContainer}
                                            style={[styles.tab, active && styles.tabActive, alert && styles.tabAlert]}
                                            onPress={() => setTab(key)}
                                            accessibilityRole="tab"
                                            accessibilityState={{ selected: active }}
                                            accessibilityLabel={`${label}: ${count}`}
                                        >
                                            <Text style={[styles.tabText, active && styles.tabTextActive, alert && styles.tabTextAlert]}>{label}</Text>
                                            <Text style={[styles.tabCount, active && styles.tabTextActive, alert && styles.tabTextAlert]}>{count}</Text>
                                        </PressableScale>
                                    );
                                })}
                            </View>
                        </Animated.View>
                    </View>
                </View>
            }
            renderItem={({ item: row }) =>
                row.kind === 'sent' ? (
                    <View style={styles.row}>
                        <SyncCard
                            identificador={`Coleta ${row.record.clientId.slice(0, 8)}`}
                            pesquisa={titleOf(row.record.researchId)}
                            data={formatDateTime(row.record.finishedAt ?? row.record.startedAt)}
                            enviadaEm={formatDateTime(row.record.sentAt)}
                            status="sincronizado"
                        />
                    </View>
                ) : (
                    <View style={styles.row}>
                        <SyncCard
                            identificador={`Coleta ${row.item.clientId.slice(0, 8)}`}
                            pesquisa={titleOf(row.item.researchId)}
                            data={formatDateTime(row.item.finishedAt ?? row.item.startedAt)}
                            status={statusOf(row.item)}
                            motivo={row.item.sendState?.lastFailure?.reason}
                            tentativas={row.item.sendState?.attempts}
                            onRetry={() => void syncQueue.run({ trigger: 'manual', only: row.item.clientId })}
                            retryDisabled={!canSend}
                            onDiscard={canDiscard(row.item) ? () => confirmDiscard(row.item) : undefined}
                            discardDisabled={sync.running}
                        />
                    </View>
                )
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
                <View style={styles.emptyState}>
                    <View style={styles.emptyIcon}><CloudUpload size={26} color={Brand.greenDeep} strokeWidth={1.7} /></View>
                    <Text style={styles.emptyText}>
                        {tab === 'pendentes' && drafts > 0
                            ? 'As coletas finalizadas aparecem aqui até serem enviadas.'
                            : EMPTY_TEXT[tab]}
                    </Text>
                </View>
            }
        />
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Brand.paper },
    content: { paddingBottom: TAB_BAR_CLEARANCE },
    hero: {
        backgroundColor: Brand.forest,
        paddingHorizontal: 22,
        paddingTop: 18,
        paddingBottom: 22,
        borderBottomLeftRadius: Radius.hero,
        borderBottomRightRadius: Radius.hero,
        overflow: 'hidden',
    },
    heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    title: { flex: 1, fontSize: 28, fontWeight: '600', letterSpacing: -0.8, color: '#fff' },
    subtitle: { fontSize: 14, color: Brand.mutedDark, marginTop: 6, lineHeight: 20, maxWidth: 300 },
    strip: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 22,
        paddingVertical: 14,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: Brand.lineDark,
        backgroundColor: 'rgba(191, 227, 208, 0.07)',
    },
    stat: { flex: 1, alignItems: 'center', gap: 2 },
    statValue: { color: Brand.fgDark, fontSize: 26, fontWeight: '300', letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
    statValueAlert: { color: '#f0b9a8' },
    statLabel: { color: Brand.mutedDark, fontSize: 11.5 },
    stripDivider: { width: 1, height: 30, backgroundColor: Brand.lineDark },
    headerBody: { padding: 18, paddingBottom: 6, gap: 22 },
    sendButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        minHeight: 54,
        borderRadius: 999,
        backgroundColor: Brand.ink,
        paddingHorizontal: 20,
    },
    sendButtonDisabled: { backgroundColor: '#9aa8a0' },
    sendButtonText: { fontSize: 15, fontWeight: '500', color: '#fff' },
    runProgress: { marginTop: -8 },
    noteWrap: { marginTop: -8 },
    resultPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        marginTop: -8,
        paddingHorizontal: 12,
        height: 30,
        borderRadius: 999,
        backgroundColor: Brand.chipLight,
    },
    resultPillWarning: { backgroundColor: Brand.clayLight },
    resultNote: { fontSize: 13, fontWeight: '500', color: Brand.greenDeep },
    resultNoteWarning: { color: Brand.clayInk },
    storageCard: {
        backgroundColor: Brand.card,
        borderWidth: 1,
        borderColor: Brand.line,
        borderRadius: 24,
        padding: 16,
        gap: 8,
    },
    storageTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    storageIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: Brand.chipLight, alignItems: 'center', justifyContent: 'center' },
    storageLabel: { flex: 1, fontSize: 13.5, lineHeight: 18, color: Brand.muted },
    storageTotal: { fontSize: 44, fontWeight: '300', letterSpacing: -2, color: Brand.ink, fontVariant: ['tabular-nums'] },
    splitBar: { flexDirection: 'row', height: 8, borderRadius: 4, backgroundColor: Brand.trackLight, overflow: 'hidden', gap: 2 },
    splitPhotos: { backgroundColor: Brand.green, borderRadius: 4 },
    splitAudio: { backgroundColor: Brand.mint, borderRadius: 4 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 4 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendFree: { marginLeft: 'auto' },
    storageDetail: { fontSize: 13, color: Brand.muted },
    storageNote: { fontSize: 12, color: Brand.muted },
    spaceWarning: { fontSize: 13, lineHeight: 18, color: Brand.warn, backgroundColor: Brand.warnLight, borderRadius: 14, padding: 12, marginTop: 4 },
    spaceWarningCritical: { color: Brand.clayInk, backgroundColor: Brand.clayLight },
    releaseBox: { marginTop: 6, gap: 8 },
    releaseButton: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 6,
        paddingHorizontal: 16,
        minHeight: 40,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#cdd5d0',
    },
    releaseText: { fontSize: 13, fontWeight: '500', color: Brand.ink },
    section: { gap: 12 },
    sectionTight: { gap: 12, marginBottom: 4 },
    sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    sectionTitle: { fontSize: 16, fontWeight: '600', letterSpacing: -0.3, color: Brand.ink },
    sectionRight: { fontSize: 12.5, color: Brand.muted },
    tabs: { flexDirection: 'row', gap: 8 },
    tabContainer: { flex: 1 },
    tab: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: 42,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#cdd5d0',
        backgroundColor: Brand.card,
    },
    tabActive: { backgroundColor: Brand.ink, borderColor: Brand.ink },
    tabAlert: { borderColor: '#e9c5b9', backgroundColor: Brand.clayLight },
    tabText: { fontSize: 13, fontWeight: '500', color: Brand.ink },
    tabTextActive: { color: '#fff' },
    tabTextAlert: { color: Brand.clayInk },
    tabCount: { fontSize: 13, fontWeight: '600', color: Brand.muted, fontVariant: ['tabular-nums'] },
    row: { paddingHorizontal: 18 },
    separator: { height: 12 },
    emptyState: { justifyContent: 'center', alignItems: 'center', padding: 40, gap: 12 },
    emptyIcon: {
        width: 56,
        height: 56,
        borderRadius: 18,
        backgroundColor: Brand.chipLight,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyText: { fontSize: 14, color: Brand.muted, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
});

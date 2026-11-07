import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Check, CloudUpload, Download, FileText, PenLine } from 'lucide-react-native';
import Animated, {
    Easing,
    FadeInDown,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';
import Chip from '@/components/Chip';
import Contour from '@/components/Contour';
import ActionCard from '@/components/home/ActionCard';
import CountUp from '@/components/home/CountUp';
import ResearchRow from '@/components/home/ResearchRow';
import WeekActivity from '@/components/home/WeekActivity';
import { MESES, computeStats, formatLongDate, greeting } from '@/components/home/homeStats';
import { Brand, Radius, TAB_BAR_CLEARANCE } from '@/constants/brand';
import { useAuth } from '@/context/AuthContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { listCollections, type LocalCollection } from '@/lib/collectionStore';
import { formatApiDate } from '@/lib/formatDate';
import { getCachedResearches, syncResearches, type Research } from '@/lib/researchCache';
import { computeProgress } from '@/lib/researchProgress';
import { t } from '@/i18n';
import { listSent, type SentRecord } from '@/lib/sentHistory';
import InfoCard from './_components/infoCards';

const MAX_ROWS = 4;

/** Primeiro nome com a inicial maiúscula (padrão: "Pesquisador"). */
const firstName = (name?: string) => {
    const first = name?.trim().split(' ')[0] || 'Pesquisador';
    return first.charAt(0).toUpperCase() + first.slice(1);
};

/** Entrada escalonada: cada bloco sobe e aparece um pouco depois do anterior. */
const enter = (index: number) =>
    FadeInDown.delay(120 + index * 80)
        .duration(480)
        .easing(Easing.out(Easing.cubic));

/** Título de uma seção da tela, com ação opcional à direita. */
function SectionHeader({ title, right, onRight }: { title: string; right?: string; onRight?: () => void }) {
    return (
        <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {right ? (
                <Pressable onPress={onRight} disabled={!onRight} hitSlop={10} accessibilityRole={onRight ? 'button' : 'text'}>
                    <Text style={[styles.sectionRight, onRight && styles.sectionLink]}>{right}</Text>
                </Pressable>
            ) : null}
        </View>
    );
}

/** Número em destaque no topo da tela, com o rótulo. */
function HeroStat({ value, label }: { value: number; label: string }) {
    return (
        <View style={styles.stat}>
            <Text style={styles.statValue}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
        </View>
    );
}

/** Tela inicial do pesquisador: saudação, números do dia, atividade da semana e pesquisas. */
export default function Home() {
    const router = useRouter();
    const { user } = useAuth();
    const isOnline = useNetworkStatus();
    const [researches, setResearches] = useState<Research[]>([]);
    const [collections, setCollections] = useState<LocalCollection[]>([]);
    const [sent, setSent] = useState<SentRecord[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    // As curvas de nível "respiram" devagar: movimento ambiente, sem chamar atenção.
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

    const loadData = useCallback(async () => {
        if (isOnline) {
            try {
                await syncResearches();
            } catch (error) {
                console.log('Falha ao sincronizar pesquisas na Home:', error);
            }
        }
        const [cachedResearches, allCollections, sentRecords] = await Promise.all([
            getCachedResearches(),
            listCollections(),
            listSent().catch(() => [] as SentRecord[]),
        ]);
        setResearches(cachedResearches);
        setCollections(allCollections);
        setSent(sentRecords);
    }, [isOnline]);

    useFocusEffect(
        useCallback(() => {
            loadData();
        }, [loadData])
    );

    const handleRefresh = async () => {
        setRefreshing(true);
        await loadData();
        setRefreshing(false);
    };

    const available = useMemo(() => researches.filter((item) => item.status !== 'DRAFT'), [researches]);
    const finished = useMemo(() => collections.filter((c) => c.status === 'FINISHED'), [collections]);
    const drafts = useMemo(() => collections.filter((c) => c.status !== 'FINISHED'), [collections]);
    const stats = useMemo(() => computeStats(finished, sent), [finished, sent]);

    // Pesquisas com o progresso frente à meta: as baixadas primeiro, e as mais atrasadas antes das concluídas.
    const rows = useMemo(() => {
        const list = available
            .filter((item) => !item.revoked)
            .map((research) => {
                const pendingIds = finished.filter((c) => c.researchId === research.id).map((c) => c.clientId);
                return { research, progress: computeProgress(research, sent, pendingIds) };
            });
        list.sort(
            (a, b) =>
                Number(!!b.research.isDownloaded) - Number(!!a.research.isDownloaded) ||
                (a.progress.percent ?? 101) - (b.progress.percent ?? 101)
        );
        return list;
    }, [available, finished, sent]);

    const goResearches = () => router.push('/(app)/pesquisas');
    const goSync = () => router.push('/(app)/sincronizacao');

    const resumeDraft = () => {
        if (drafts.length === 1) {
            router.push({
                pathname: '/coleta/[researchId]',
                params: { researchId: String(drafts[0].researchId), clientId: drafts[0].clientId },
            });
            return;
        }
        goResearches();
    };

    const draftTitle =
        drafts.length === 1 ? available.find((item) => item.id === drafts[0].researchId)?.title : undefined;
    const hasDownloaded = available.some((item) => item.isDownloaded);
    const name = firstName(user?.name);
    const monthName = MESES[new Date().getMonth()];
    const nothingToDo = finished.length === 0 && drafts.length === 0;

    let sectionIndex = 0;

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Brand.green} />}
        >
            <View style={styles.hero}>
                <Animated.View style={[StyleSheet.absoluteFill, contourStyle]} pointerEvents="none">
                    <Contour seed={4.1} rings={10} cx={0.8} cy={0.7} size={1} opacity={0.8} color={Brand.green} />
                </Animated.View>

                <View style={styles.heroRow}>
                    <Chip label={isOnline ? 'Online' : 'Offline'} tone={isOnline ? 'dark' : 'clay'} />
                    <Pressable
                        onPress={() => router.push('/(app)/usuario')}
                        accessibilityRole="button"
                        accessibilityLabel="Abrir perfil"
                        style={styles.avatarRing}
                    >
                        <View style={styles.avatar}>
                            <Text style={styles.avatarText}>{name.charAt(0)}</Text>
                        </View>
                    </Pressable>
                </View>

                <Text style={styles.hi}>
                    {greeting()}, {name}
                </Text>
                <Text style={styles.date}>{formatLongDate()}</Text>

                <Text style={styles.monthLabel}>Neste mês de {monthName}</Text>
                <CountUp
                    value={stats.month}
                    style={styles.big}
                    accessibilityLabel={`${stats.month} coletas feitas neste mês`}
                />
                <Text style={styles.cap}>{stats.month === 1 ? 'coleta finalizada' : 'coletas finalizadas'}</Text>

                <Animated.View entering={enter(0)} style={styles.strip}>
                    <HeroStat value={stats.today} label="hoje" />
                    <View style={styles.stripDivider} />
                    <HeroStat value={stats.last7} label="últimos 7 dias" />
                    <View style={styles.stripDivider} />
                    <HeroStat value={stats.lastMonth} label="mês passado" />
                </Animated.View>
            </View>

            <View style={styles.body}>
                <Animated.View entering={enter(++sectionIndex)} style={styles.stack}>
                    {finished.length > 0 ? (
                        <ActionCard
                            tone="clay"
                            icon={<CloudUpload size={22} color={Brand.clayInk} strokeWidth={1.8} />}
                            title={
                                finished.length === 1
                                    ? '1 coleta aguarda envio'
                                    : `${finished.length} coletas aguardam envio`
                            }
                            text={
                                isOnline
                                    ? 'Abra Sinc para acompanhar ou enviar agora.'
                                    : 'Sem internet: o envio acontece sozinho quando a rede voltar.'
                            }
                            cta="Abrir Sinc"
                            onPress={goSync}
                        />
                    ) : null}

                    {drafts.length > 0 ? (
                        <ActionCard
                            tone="green"
                            icon={<PenLine size={22} color={Brand.greenDeep} strokeWidth={1.8} />}
                            title={drafts.length === 1 ? 'Retome sua coleta' : `${drafts.length} rascunhos em andamento`}
                            text={
                                drafts.length === 1
                                    ? draftTitle
                                        ? `Rascunho em "${draftTitle}".`
                                        : 'Você tem 1 rascunho em andamento.'
                                    : 'Escolha qual coleta continuar em Pesquisas.'
                            }
                            cta={drafts.length === 1 ? 'Continuar' : 'Ver rascunhos'}
                            onPress={resumeDraft}
                        />
                    ) : null}

                    {/* Modo campo desativado: o card que abria /campo foi removido (o mapa precisa de chave do Google Maps) */}

                    {nothingToDo ? (
                        hasDownloaded ? (
                            <ActionCard
                                tone="calm"
                                icon={<Check size={22} color={Brand.greenDeep} strokeWidth={2.2} />}
                                title="Tudo em dia"
                                text="Nenhuma coleta pendente. Pronto para o campo."
                                cta="Iniciar coleta"
                                onPress={goResearches}
                            />
                        ) : available.length > 0 ? (
                            <ActionCard
                                tone="calm"
                                icon={<Download size={22} color={Brand.greenDeep} strokeWidth={1.8} />}
                                title="Baixe uma pesquisa"
                                text={
                                    isOnline
                                        ? 'Deixe-a no aparelho para coletar mesmo sem internet.'
                                        : 'Conecte-se à internet para baixar suas pesquisas.'
                                }
                                cta="Ir para Pesquisas"
                                onPress={goResearches}
                            />
                        ) : (
                            <ActionCard
                                tone="calm"
                                icon={<FileText size={22} color={Brand.greenDeep} strokeWidth={1.8} />}
                                title="Aguardando pesquisas"
                                text="Quando o administrador vincular uma pesquisa a você, ela aparece aqui."
                            />
                        )
                    ) : null}
                </Animated.View>

                <Animated.View entering={enter(++sectionIndex)} style={styles.section}>
                    <SectionHeader title="Resumo do aparelho" />
                    <View style={styles.cards}>
                        <InfoCard
                            value={available.length}
                            label={available.length === 1 ? 'pesquisa disponível' : 'pesquisas disponíveis'}
                            icon={<FileText size={18} color={Brand.greenDeep} strokeWidth={1.8} />}
                            onPress={goResearches}
                        />
                        <InfoCard
                            value={finished.length}
                            label={finished.length === 1 ? 'coleta para enviar' : 'coletas para enviar'}
                            icon={
                                <CloudUpload
                                    size={18}
                                    color={finished.length > 0 ? Brand.clayInk : Brand.greenDeep}
                                    strokeWidth={1.8}
                                />
                            }
                            tone={finished.length > 0 ? 'clay' : 'light'}
                            onPress={goSync}
                        />
                    </View>
                </Animated.View>

                <Animated.View entering={enter(++sectionIndex)} style={styles.section}>
                    <SectionHeader
                        title="Últimos 7 dias"
                        right={`${stats.last7} ${stats.last7 === 1 ? 'coleta' : 'coletas'}`}
                    />
                    <WeekActivity days={stats.days} />
                </Animated.View>

                {rows.length > 0 ? (
                    <Animated.View entering={enter(++sectionIndex)} style={styles.section}>
                        <SectionHeader
                            title="Minhas pesquisas"
                            right={rows.length > MAX_ROWS ? `Ver todas (${rows.length})` : 'Ver todas'}
                            onRight={goResearches}
                        />
                        <View style={styles.stack}>
                            {rows.slice(0, MAX_ROWS).map(({ research, progress }, index) => (
                                <ResearchRow
                                    key={research.id}
                                    title={research.title}
                                    subtitle={`Vigente até ${formatApiDate(research.endDate)}`}
                                    downloaded={!!research.isDownloaded}
                                    done={progress.done}
                                    target={progress.target}
                                    percent={progress.percent}
                                    pending={progress.pending}
                                    delay={300 + index * 90}
                                    onPress={goResearches}
                                />
                            ))}
                        </View>
                    </Animated.View>
                ) : null}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Brand.paper },
    content: { flexGrow: 1, paddingBottom: TAB_BAR_CLEARANCE },
    hero: {
        backgroundColor: Brand.forest,
        paddingHorizontal: 22,
        paddingTop: 18,
        paddingBottom: 22,
        borderBottomLeftRadius: Radius.hero,
        borderBottomRightRadius: Radius.hero,
        overflow: 'hidden',
    },
    heroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    avatarRing: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: Brand.lineDark,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: Brand.mint,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarText: { color: Brand.forest, fontWeight: '700', fontSize: 15 },
    hi: { color: Brand.fgDark, marginTop: 22, fontSize: 22, fontWeight: '600', letterSpacing: -0.5 },
    date: { color: Brand.mutedDark, marginTop: 2, fontSize: 13.5 },
    monthLabel: { color: Brand.mutedDark, marginTop: 22, fontSize: 14 },
    big: {
        color: '#fff',
        fontSize: 88,
        fontWeight: '300',
        letterSpacing: -6,
        lineHeight: 92,
        marginTop: 4,
        fontVariant: ['tabular-nums'],
    },
    cap: { color: Brand.fgDark, fontSize: 15, marginTop: 2 },
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
    statValue: { color: Brand.fgDark, fontSize: 22, fontWeight: '300', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
    statLabel: { color: Brand.mutedDark, fontSize: 11.5 },
    stripDivider: { width: 1, height: 28, backgroundColor: Brand.lineDark },
    body: { padding: 18, gap: 22 },
    stack: { gap: 10 },
    section: { gap: 12 },
    sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    sectionTitle: { fontSize: 16, fontWeight: '600', letterSpacing: -0.3, color: Brand.ink },
    sectionRight: { fontSize: 12.5, color: Brand.muted },
    sectionLink: { color: Brand.greenDeep, fontWeight: '600' },
    cards: { flexDirection: 'row', gap: 12 },
});
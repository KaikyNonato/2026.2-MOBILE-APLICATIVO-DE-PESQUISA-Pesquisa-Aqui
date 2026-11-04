import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, RefreshControl, Alert } from 'react-native';
import { FileText, PlayCircle, WifiOff } from 'lucide-react-native';
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
import { Brand, Radius, TAB_BAR_CLEARANCE } from '@/constants/brand';
import { router, useFocusEffect } from 'expo-router';
import PesquisaCard from './_components/PesquisaCard';
import DraftPickerModal from './_components/DraftPickerModal';
import { getCachedResearches, syncResearches, downloadResearchPackage, type Research } from '@/lib/researchCache';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { listCollections, type LocalCollection } from '@/lib/collectionStore';
import { useRemoveResearch } from '@/hooks/useRemoveResearch';
import { listSent, type SentRecord } from '@/lib/sentHistory';
import { computeProgress } from '@/lib/researchProgress';
import { discardDraft } from '@/lib/collectionDiscard';
import { reconcileNotifications } from '@/lib/notifications';
import { formatRelativeTime, getDraftsProgress, type DraftProgress } from '@/lib/draftProgress';

/** Entrada escalonada, igual à da Home: cada bloco sobe e aparece um pouco depois do anterior. */
const enter = (index: number) =>
    FadeInDown.delay(120 + Math.min(index, 8) * 70)
        .duration(480)
        .easing(Easing.out(Easing.cubic));

/** Título de uma seção da tela, com texto opcional à direita. */
function SectionHeader({ title, right }: { title: string; right?: string }) {
    return (
        <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {right ? <Text style={styles.sectionRight}>{right}</Text> : null}
        </View>
    );
}

/** Número em destaque no topo da tela, com o rótulo. */
function HeroStat({ value, label }: { value: number; label: string }) {
    return (
        <View style={styles.stat}>
            <CountUp value={value} style={styles.statValue} />
            <Text style={styles.statLabel}>{label}</Text>
        </View>
    );
}

/**
 * Tela de pesquisas: lista as pesquisas do pesquisador, baixa e devolve do aparelho e inicia
 * coletas.
 */
export default function Pesquisas() {
    const [pesquisas, setPesquisas] = useState<Research[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [collections, setCollections] = useState<LocalCollection[]>([]);
    const [downloadingIds, setDownloadingIds] = useState<Set<number>>(new Set());
    // Pesquisa cujos rascunhos o pesquisador está escolhendo (null = lista fechada)
    const [pickingResearch, setPickingResearch] = useState<Research | null>(null);
    const [sent, setSent] = useState<SentRecord[]>([]);
    const [draftProgress, setDraftProgress] = useState<Record<string, DraftProgress>>({});
    const isOnline = useNetworkStatus();

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

    // Atualiza a lista e avisa se o administrador revogou o acesso deste aparelho a alguma pesquisa
    // (a cópia local já foi apagada pela sincronização).
    const syncAndWarn = useCallback(async () => {
        const revoked = await syncResearches();
        // A pessoa está vendo a lista agora: o que aparece aqui não precisa virar aviso depois.
        await reconcileNotifications({ silent: true });
        if (revoked.length > 0) {
            const nomes = revoked.map((r) => `"${r.title}"`).join(', ');
            Alert.alert(
                'Acesso revogado',
                `O administrador revogou o acesso deste aparelho a ${nomes}. A pesquisa foi removida do aparelho e não pode mais ser baixada aqui.`,
            );
        }
    }, []);

    const loadFromCache = useCallback(async () => {
        const cached = await getCachedResearches();
        setPesquisas(cached);
        // Coletas e rascunhos ficam no aparelho: a contagem funciona sem internet
        setCollections(await listCollections());
        setSent(await listSent().catch(() => [] as SentRecord[]));
    }, []);

    useFocusEffect(
        useCallback(() => {
            const run = async () => {
                if (isOnline) {
                    try { await syncAndWarn(); }
                    catch (error) { console.log('Falha ao sincronizar pesquisas:', error); }
                }
                await loadFromCache();
            };
            run();
        }, [isOnline, loadFromCache, syncAndWarn])
    );

    const handleRefresh = async () => {
        setRefreshing(true);
        if (isOnline) {
            try { await syncAndWarn(); }
            catch (error) { console.log('Falha ao sincronizar no refresh:', error); }
        }
        await loadFromCache();
        setRefreshing(false);
    };

    // Remover do aparelho: bloqueado com coleta pendente, pede confirmação e avisa o servidor (a cópia deixa de
    // contar como ativa). Depois, a pesquisa volta à lista como "Não baixada".
    const removeResearch = useRemoveResearch(isOnline, loadFromCache);

    const handleDownload = async (id: number, title: string) => {
        if (!isOnline) {
            Alert.alert("Sem conexão", "Conecte-se à internet para baixar esta pesquisa.");
            return;
        }

        setDownloadingIds(prev => new Set(prev).add(id));
        try {
            await downloadResearchPackage(id);
            Alert.alert("Sucesso", `A pesquisa "${title}" foi baixada e está pronta para uso offline.`);
            await loadFromCache(); // Atualiza a lista para refletir o status
        } catch (error) {
            const reason = error instanceof Error ? error.message : "A conexão falhou ou ocorreu um erro.";
            Alert.alert("Erro", `${reason} A pesquisa não foi baixada.`);
        } finally {
            setDownloadingIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

    const startCollection = (researchId: number) => {
        router.push({ pathname: '/coleta/[researchId]', params: { researchId: String(researchId) } });
    };

    const openDraft = (researchId: number, clientId: string) => {
        router.push({
            pathname: '/coleta/[researchId]',
            params: { researchId: String(researchId), clientId },
        });
    };

    const draftsOf = (researchId: number) =>
        collections.filter((c) => c.researchId === researchId && c.status === 'IN_PROGRESS');

    // Um rascunho: retoma direto. Vários: o pesquisador escolhe qual continuar.
    const resumeDraft = (research: Research) => {
        const drafts = draftsOf(research.id);
        if (drafts.length === 0) return startCollection(research.id);
        if (drafts.length === 1) return openDraft(research.id, drafts[0].clientId);
        setPickingResearch(research);
    };

    // Entrevista interrompida: o rascunho mexido mais recentemente, de uma pesquisa que ainda está no aparelho.
    const interrupted = useMemo(() => {
        const usable = new Set(pesquisas.filter((p) => p.isDownloaded && !p.revoked && p.status !== 'DRAFT').map((p) => p.id));
        return collections
            .filter((c) => c.status === 'IN_PROGRESS' && usable.has(c.researchId))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
    }, [collections, pesquisas]);

    // Quantas questões cada rascunho já tem respondidas (conta só as visíveis, segundo as regras de exibição).
    useEffect(() => {
        const drafts = collections.filter((c) => c.status === 'IN_PROGRESS');
        if (drafts.length === 0) return;
        let cancelled = false;
        getDraftsProgress(drafts).then((result) => { if (!cancelled) setDraftProgress(result); }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [collections]);

    const askDiscardDraft = (draft: LocalCollection) => {
        Alert.alert(
            'Apagar rascunho',
            'As respostas, fotos e áudios deste rascunho serão apagados do aparelho e não poderão ser recuperados.',
            [
                { text: 'Manter', style: 'cancel' },
                {
                    text: 'Apagar',
                    style: 'destructive',
                    onPress: async () => {
                        await discardDraft(draft.clientId);
                        await loadFromCache();
                        // Era o último rascunho da lista aberta: fecha o modal
                        if (draftsOf(draft.researchId).filter((d) => d.clientId !== draft.clientId).length === 0) setPickingResearch(null);
                    },
                },
            ],
        );
    };

    const finishedOf = (researchId: number) =>
        collections.filter((c) => c.researchId === researchId && c.status === 'FINISHED');

    // Três grupos: as que já estão no aparelho, as que podem ser baixadas e as sem acesso.
    const { onDevice, toDownload, revokedList } = useMemo(() => {
        const visible = pesquisas.filter((p) => p.status !== 'DRAFT');
        return {
            onDevice: visible.filter((p) => p.isDownloaded && !p.revoked),
            toDownload: visible.filter((p) => !p.isDownloaded && !p.revoked),
            revokedList: visible.filter((p) => p.revoked),
        };
    }, [pesquisas]);

    const totalFinished = collections.filter((c) => c.status === 'FINISHED').length;
    const totalDrafts = collections.filter((c) => c.status === 'IN_PROGRESS').length;

    let cardIndex = 0;
    const renderCard = (item: Research) => {
        const index = cardIndex++;
        const progress = computeProgress(
            item,
            sent,
            finishedOf(item.id).map((c) => c.clientId),
        );
        return (
            <Animated.View key={item.id} entering={enter(index + 1)}>
                <PesquisaCard
                    titulo={item.title}
                    targetAudience={item.targetAudience}
                    startDate={item.startDate}
                    endDate={item.endDate}
                    isDownloaded={!!item.isDownloaded}
                    isOnline={isOnline}
                    isDownloading={downloadingIds.has(item.id)}
                    coletasCount={finishedOf(item.id).length}
                    draftCount={draftsOf(item.id).length}
                    revoked={!!item.revoked}
                    progress={progress}
                    delay={300 + index * 90}
                    onDownload={() => handleDownload(item.id, item.title)}
                    onReturn={() => void removeResearch(item.id, item.title)}
                    onStart={() => startCollection(item.id)}
                    onResume={() => resumeDraft(item)}
                />
            </Animated.View>
        );
    };

    return (
        <View style={styles.container}>
            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Brand.green} />}
            >
                <View style={styles.hero}>
                    <Animated.View style={[StyleSheet.absoluteFill, contourStyle]} pointerEvents="none">
                        <Contour seed={2.2} rings={10} cx={0.85} cy={0.35} size={1} opacity={0.8} color={Brand.green} />
                    </Animated.View>

                    <View style={styles.heroRow}>
                        <Text style={styles.title} accessibilityRole="header">
                            Minhas pesquisas
                        </Text>
                        <Chip label={isOnline ? 'Online' : 'Offline'} tone={isOnline ? 'dark' : 'clay'} />
                    </View>
                    <Text style={styles.subtitle}>
                        {isOnline
                            ? 'Baixe uma pesquisa para coletar respostas no campo.'
                            : 'Sem internet. Mostrando o que já está salvo no aparelho.'}
                    </Text>

                    <Animated.View entering={enter(0)} style={styles.strip}>
                        <HeroStat value={onDevice.length} label="no aparelho" />
                        <View style={styles.stripDivider} />
                        <HeroStat value={totalFinished} label={totalFinished === 1 ? 'coleta feita' : 'coletas feitas'} />
                        <View style={styles.stripDivider} />
                        <HeroStat value={totalDrafts} label={totalDrafts === 1 ? 'rascunho' : 'rascunhos'} />
                    </Animated.View>
                </View>

                {pesquisas.length === 0 ? (
                    <Animated.View entering={enter(1)} style={styles.emptyState}>
                        <View style={styles.emptyIcon}>
                            <FileText size={26} color={Brand.greenDeep} strokeWidth={1.7} />
                        </View>
                        <Text style={styles.emptyTitle}>
                            {isOnline ? 'Nenhuma pesquisa atribuída' : 'Nenhuma pesquisa no aparelho'}
                        </Text>
                        <Text style={styles.emptyText}>
                            {isOnline
                                ? 'Quando o administrador vincular uma pesquisa a você, ela aparece aqui.'
                                : 'Conecte-se à internet para baixar suas pesquisas.'}
                        </Text>
                    </Animated.View>
                ) : (
                    <View style={styles.body}>
                        {!isOnline && toDownload.length > 0 ? (
                            <Animated.View entering={enter(1)}>
                                <ActionCard
                                    tone="clay"
                                    icon={<WifiOff size={22} color={Brand.clayInk} strokeWidth={1.8} />}
                                    title="Sem conexão"
                                    text={`Conecte-se à internet para baixar ${toDownload.length === 1 ? 'a pesquisa disponível' : `as ${toDownload.length} pesquisas disponíveis`}.`}
                                />
                            </Animated.View>
                        ) : null}

                        {interrupted ? (
                            <Animated.View entering={enter(1)}>
                                <ActionCard
                                    tone="calm"
                                    icon={<PlayCircle size={22} color={Brand.greenDeep} strokeWidth={1.8} />}
                                    title="Entrevista interrompida"
                                    text={`${pesquisas.find((p) => p.id === interrupted.researchId)?.title ?? 'Pesquisa'}${draftProgress[interrupted.clientId]
                                            ? ` · ${draftProgress[interrupted.clientId].answered} de ${draftProgress[interrupted.clientId].total} questões`
                                            : ''
                                        } · editada ${formatRelativeTime(interrupted.updatedAt)}`}
                                    cta="Continuar"
                                    onPress={() => openDraft(interrupted.researchId, interrupted.clientId)}
                                />
                            </Animated.View>
                        ) : null}

                        {onDevice.length > 0 ? (
                            <View style={styles.section}>
                                <SectionHeader
                                    title="No aparelho"
                                    right={`${onDevice.length} ${onDevice.length === 1 ? 'pesquisa' : 'pesquisas'}`}
                                />
                                <View style={styles.stack}>{onDevice.map(renderCard)}</View>
                            </View>
                        ) : null}

                        {toDownload.length > 0 ? (
                            <View style={styles.section}>
                                <SectionHeader
                                    title="Disponíveis para baixar"
                                    right={`${toDownload.length} ${toDownload.length === 1 ? 'pesquisa' : 'pesquisas'}`}
                                />
                                <View style={styles.stack}>{toDownload.map(renderCard)}</View>
                            </View>
                        ) : null}

                        {revokedList.length > 0 ? (
                            <View style={styles.section}>
                                <SectionHeader title="Sem acesso" />
                                <View style={styles.stack}>{revokedList.map(renderCard)}</View>
                            </View>
                        ) : null}
                    </View>
                )}
            </ScrollView>

            <DraftPickerModal
                visible={pickingResearch !== null}
                title={pickingResearch?.title ?? ''}
                drafts={pickingResearch ? draftsOf(pickingResearch.id) : []}
                progress={draftProgress}
                onDiscard={askDiscardDraft}
                onClose={() => setPickingResearch(null)}
                onSelect={(draft) => {
                    setPickingResearch(null);
                    openDraft(draft.researchId, draft.clientId);
                }}
            />
        </View>
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
    statLabel: { color: Brand.mutedDark, fontSize: 11.5 },
    stripDivider: { width: 1, height: 30, backgroundColor: Brand.lineDark },
    body: { padding: 18, gap: 22 },
    section: { gap: 12 },
    stack: { gap: 14 },
    sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    sectionTitle: { fontSize: 16, fontWeight: '600', letterSpacing: -0.3, color: Brand.ink },
    sectionRight: { fontSize: 12.5, color: Brand.muted },
    emptyState: { alignItems: 'center', padding: 40, paddingTop: 64, gap: 8 },
    emptyIcon: {
        width: 56,
        height: 56,
        borderRadius: 18,
        backgroundColor: Brand.chipLight,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 6,
    },
    emptyTitle: { fontSize: 17, fontWeight: '600', letterSpacing: -0.3, color: Brand.ink },
    emptyText: { fontSize: 14, color: Brand.muted, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
});

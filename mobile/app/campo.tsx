import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft, LocateFixed, MapPin, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Brand, Radius } from '@/constants/brand';
import { useSyncState } from '@/hooks/useSyncQueue';
import { listCollections, type LocalCollection } from '@/lib/collectionStore';
import {
    buildDayEntries,
    distanceOutsideArea,
    formatDistance,
    getTargetArea,
    type Coordinate,
    type DayEntry,
} from '@/lib/fieldMode';
import { getCachedResearches, type Research } from '@/lib/researchCache';
import { computeProgress } from '@/lib/researchProgress';
import { listSent, type SentRecord } from '@/lib/sentHistory';
import { t, tp } from '@/i18n';

// Modo campo: tudo o que o pesquisador precisa na rua, numa tela só. A posição vem do GPS do aparelho
// (sem internet), a meta é recalculada a cada coleta e as entrevistas do dia vêm do que está guardado no aparelho.

type GpsState =
    | { status: 'searching' }
    | { status: 'ok'; position: Coordinate; accuracy: number | null }
    | { status: 'denied'; canAskAgain: boolean }
    | { status: 'off' };

const MAX_FONT = 1.6;

const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const distanceText = (meters: number) => {
    const { unit, value } = formatDistance(meters);
    return t(unit === 'km' ? 'field.kmUnit' : 'field.mUnit', { value });
};

function useGps(): GpsState {
    const [state, setState] = useState<GpsState>({ status: 'searching' });

    useEffect(() => {
        let subscription: Location.LocationSubscription | null = null;
        let cancelled = false;

        (async () => {
            try {
                let permission = await Location.getForegroundPermissionsAsync();
                if (!permission.granted && permission.canAskAgain) {
                    permission = await Location.requestForegroundPermissionsAsync();
                }
                if (cancelled) return;
                if (!permission.granted) {
                    setState({ status: 'denied', canAskAgain: permission.canAskAgain });
                    return;
                }
                if (!(await Location.hasServicesEnabledAsync())) {
                    if (!cancelled) setState({ status: 'off' });
                    return;
                }
                subscription = await Location.watchPositionAsync(
                    { accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 5000 },
                    (location) => {
                        if (cancelled) return;
                        setState({
                            status: 'ok',
                            position: { latitude: location.coords.latitude, longitude: location.coords.longitude },
                            accuracy: location.coords.accuracy ?? null,
                        });
                    },
                );
                if (cancelled) subscription.remove();
            } catch {
                if (!cancelled) setState({ status: 'off' });
            }
        })();

        return () => {
            cancelled = true;
            subscription?.remove();
        };
    }, []);

    return state;
}

export default function CampoScreen() {
    const router = useRouter();
    const mapRef = useRef<MapView>(null);
    const gps = useGps();
    const syncState = useSyncState();

    const [researches, setResearches] = useState<Research[]>([]);
    const [collections, setCollections] = useState<LocalCollection[]>([]);
    const [sent, setSent] = useState<SentRecord[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [loaded, setLoaded] = useState(false);

    const load = useCallback(async () => {
        const [cached, local, history] = await Promise.all([getCachedResearches(), listCollections(), listSent()]);
        setResearches(cached.filter((r) => r.isDownloaded && !r.revoked));
        setCollections(local);
        setSent(history);
        setLoaded(true);
    }, []);

    // Atualiza ao abrir a tela e a cada mudança no envio: a meta acompanha cada coleta em tempo real.
    useFocusEffect(
        useCallback(() => {
            void load();
            // syncState muda a cada coleta enviada: refaz a leitura para a meta acompanhar.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [load, syncState]),
    );

    const research = researches.find((r) => r.id === selectedId) ?? researches[0] ?? null;

    const progress = useMemo(
        () =>
            research
                ? computeProgress(
                      research,
                      sent,
                      collections.filter((c) => c.researchId === research.id && c.status === 'FINISHED').map((c) => c.clientId),
                  )
                : null,
        [research, sent, collections],
    );

    const entries = useMemo(
        () => (research ? buildDayEntries(research.id, collections, sent) : []),
        [research, collections, sent],
    );

    const area = research ? getTargetArea(research) : null;
    const position = gps.status === 'ok' ? gps.position : null;

    const centerOnMe = () => {
        if (!position) return;
        mapRef.current?.animateToRegion({ ...position, latitudeDelta: 0.006, longitudeDelta: 0.006 }, 400);
    };

    const startInterview = () => {
        if (!research) return;
        router.push({ pathname: '/coleta/[researchId]', params: { researchId: String(research.id) } });
    };

    const openEntry = (entry: DayEntry) => {
        if (entry.status !== 'DRAFT') return;
        router.push({
            pathname: '/coleta/[researchId]',
            params: { researchId: String(entry.researchId), clientId: entry.clientId },
        });
    };

    const initialRegion = (() => {
        const center = position ?? area?.center;
        return center ? { ...center, latitudeDelta: 0.02, longitudeDelta: 0.02 } : undefined;
    })();

    const goalLabel = progress
        ? progress.target === null
            ? t('field.goalNoTarget')
            : progress.remaining === 0
              ? t('field.goalReached')
              : tp('field.goalRemaining', progress.remaining ?? 0)
        : '';

    return (
        <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
            <View style={styles.header}>
                <Pressable
                    onPress={() => router.back()}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.back')}
                    hitSlop={10}
                    style={styles.backButton}
                >
                    <ChevronLeft size={22} color={Brand.ink} />
                </Pressable>
                <View style={styles.headerText}>
                    <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT}>
                        {t('field.title')}
                    </Text>
                    <Text style={styles.subtitle} maxFontSizeMultiplier={MAX_FONT}>
                        {t('field.subtitle')}
                    </Text>
                </View>
            </View>

            {loaded && !research ? (
                <View style={styles.empty}>
                    <Text style={styles.emptyTitle} maxFontSizeMultiplier={MAX_FONT}>
                        {t('field.noResearchTitle')}
                    </Text>
                    <Text style={styles.emptyText} maxFontSizeMultiplier={MAX_FONT}>
                        {t('field.noResearchText')}
                    </Text>
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                    {researches.length > 1 ? (
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.pickerRow}
                            accessibilityLabel={t('field.researchPicker')}
                        >
                            {researches.map((item) => {
                                const active = item.id === research?.id;
                                return (
                                    <Pressable
                                        key={item.id}
                                        onPress={() => setSelectedId(item.id)}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: active }}
                                        style={[styles.pickerChip, active && styles.pickerChipActive]}
                                    >
                                        <Text
                                            numberOfLines={1}
                                            maxFontSizeMultiplier={MAX_FONT}
                                            style={[styles.pickerText, active && styles.pickerTextActive]}
                                        >
                                            {item.title}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                    ) : null}

                    {research && progress ? (
                        <View
                            style={styles.card}
                            accessible
                            accessibilityLabel={t('field.goalA11y', {
                                done: progress.done,
                                target: progress.target !== null ? ` ${t('field.goalOf', { target: progress.target })}` : '',
                                remaining: goalLabel,
                            })}
                        >
                            <Text style={styles.cardLabel} maxFontSizeMultiplier={MAX_FONT}>
                                {t('field.goalTitle')} · {research.title}
                            </Text>
                            <View style={styles.goalRow}>
                                <Text style={styles.goalValue} maxFontSizeMultiplier={MAX_FONT}>
                                    {progress.done}
                                </Text>
                                <Text style={styles.goalOf} maxFontSizeMultiplier={MAX_FONT}>
                                    {progress.target !== null ? t('field.goalOf', { target: progress.target }) : t('field.goalDone')}
                                </Text>
                            </View>
                            {progress.percent !== null ? (
                                <View style={styles.track}>
                                    <View style={[styles.fill, { width: `${Math.min(100, progress.percent)}%` }]} />
                                </View>
                            ) : null}
                            <Text style={styles.goalHint} maxFontSizeMultiplier={MAX_FONT}>
                                {goalLabel}
                                {progress.pending > 0 ? ` · ${tp('field.goalPending', progress.pending)}` : ''}
                            </Text>
                        </View>
                    ) : null}

                    <View style={styles.card}>
                        <Text style={styles.cardLabel} maxFontSizeMultiplier={MAX_FONT}>
                            {t('field.mapTitle')}
                        </Text>
                        <View style={styles.mapBox} accessible accessibilityLabel={t('field.mapA11y')}>
                            {initialRegion ? (
                                <MapView
                                    ref={mapRef}
                                    style={StyleSheet.flatten(styles.map)}
                                    provider={PROVIDER_DEFAULT}
                                    initialRegion={initialRegion}
                                    showsUserLocation
                                    showsMyLocationButton={false}
                                    toolbarEnabled={false}
                                >
                                    {area ? (
                                        <Circle
                                            center={area.center}
                                            radius={area.radiusMeters}
                                            strokeColor={Brand.green}
                                            fillColor="rgba(68, 119, 98, 0.14)"
                                            strokeWidth={2}
                                        />
                                    ) : null}
                                    {entries
                                        .filter((e) => e.position)
                                        .map((e) => (
                                            <Marker
                                                key={e.clientId}
                                                coordinate={e.position as Coordinate}
                                                pinColor={e.status === 'DRAFT' ? Brand.clay : Brand.green}
                                                title={formatTime(e.startedAt)}
                                            />
                                        ))}
                                </MapView>
                            ) : (
                                <View style={styles.mapPlaceholder}>
                                    <MapPin size={28} color={Brand.muted} />
                                </View>
                            )}
                            {position ? (
                                <Pressable
                                    onPress={centerOnMe}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('field.centerOnMe')}
                                    style={styles.locateButton}
                                >
                                    <LocateFixed size={22} color={Brand.greenDeep} />
                                </Pressable>
                            ) : null}
                        </View>

                        <View style={styles.statusBlock} accessibilityLiveRegion="polite">
                            {gps.status === 'ok' ? (
                                <>
                                    <Text style={styles.statusStrong} maxFontSizeMultiplier={MAX_FONT}>
                                        {t('field.position')}
                                        {gps.accuracy !== null
                                            ? ` · ${t('field.accuracy', { meters: Math.round(gps.accuracy) })}`
                                            : ''}
                                    </Text>
                                    <Text style={styles.statusText} maxFontSizeMultiplier={MAX_FONT}>
                                        {area
                                            ? (() => {
                                                  const outside = distanceOutsideArea(gps.position, area);
                                                  return outside === 0
                                                      ? t('field.areaInside')
                                                      : t('field.areaOutside', { distance: distanceText(outside) });
                                              })()
                                            : t('field.areaNone')}
                                    </Text>
                                </>
                            ) : gps.status === 'searching' ? (
                                <Text style={styles.statusText} maxFontSizeMultiplier={MAX_FONT}>
                                    {t('field.gpsSearching')}
                                </Text>
                            ) : gps.status === 'denied' ? (
                                <>
                                    <Text style={styles.statusText} maxFontSizeMultiplier={MAX_FONT}>
                                        {t('field.gpsDenied')}
                                    </Text>
                                    <Pressable
                                        onPress={() => void Linking.openSettings()}
                                        accessibilityRole="link"
                                        style={styles.linkButton}
                                    >
                                        <Text style={styles.linkText} maxFontSizeMultiplier={MAX_FONT}>
                                            {t('field.gpsDeniedAction')}
                                        </Text>
                                    </Pressable>
                                </>
                            ) : (
                                <Text style={styles.statusText} maxFontSizeMultiplier={MAX_FONT}>
                                    {t('field.gpsOff')}
                                </Text>
                            )}
                        </View>
                    </View>

                    {research ? (
                        <Pressable
                            onPress={startInterview}
                            accessibilityRole="button"
                            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                        >
                            <Plus size={20} color="#fff" />
                            <Text style={styles.primaryText} maxFontSizeMultiplier={MAX_FONT}>
                                {t('field.newInterview')}
                            </Text>
                        </Pressable>
                    ) : null}

                    <View style={styles.card}>
                        <Text style={styles.cardLabel} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT}>
                            {t('field.todayTitle')}
                        </Text>
                        {entries.length === 0 ? (
                            <Text style={styles.statusText} maxFontSizeMultiplier={MAX_FONT}>
                                {t('field.todayEmpty')}
                            </Text>
                        ) : (
                            entries.map((entry) => {
                                const statusLabel =
                                    entry.status === 'DRAFT'
                                        ? t('field.statusDraft')
                                        : entry.status === 'PENDING'
                                          ? t('field.statusPending')
                                          : t('field.statusSent');
                                const tappable = entry.status === 'DRAFT';
                                return (
                                    <Pressable
                                        key={entry.clientId}
                                        disabled={!tappable}
                                        onPress={() => openEntry(entry)}
                                        accessibilityRole={tappable ? 'button' : 'text'}
                                        accessibilityLabel={t('field.entryA11y', {
                                            time: formatTime(entry.startedAt),
                                            status: statusLabel,
                                        })}
                                        accessibilityHint={tappable ? t('field.continueDraft') : undefined}
                                        style={styles.entry}
                                    >
                                        <Text style={styles.entryTime} maxFontSizeMultiplier={MAX_FONT}>
                                            {formatTime(entry.startedAt)}
                                        </Text>
                                        <View style={styles.entryBody}>
                                            <Text style={styles.entryStatus} maxFontSizeMultiplier={MAX_FONT}>
                                                {statusLabel}
                                            </Text>
                                            {entry.durationMinutes !== null ? (
                                                <Text style={styles.entryMeta} maxFontSizeMultiplier={MAX_FONT}>
                                                    {t('field.duration', { minutes: entry.durationMinutes })}
                                                </Text>
                                            ) : null}
                                        </View>
                                        <View
                                            style={[
                                                styles.dot,
                                                entry.status === 'DRAFT' && { backgroundColor: Brand.clay },
                                                entry.status === 'PENDING' && { backgroundColor: Brand.warn },
                                                entry.status === 'SENT' && { backgroundColor: Brand.green },
                                            ]}
                                        />
                                    </Pressable>
                                );
                            })
                        )}
                    </View>
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: Brand.paper },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    backButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Brand.card,
        borderWidth: 1,
        borderColor: Brand.line,
    },
    headerText: { flex: 1 },
    title: { fontSize: 22, fontWeight: '700', color: Brand.ink },
    subtitle: { fontSize: 13, color: Brand.muted, marginTop: 2 },
    content: { padding: 16, gap: 14, paddingBottom: 32 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: Brand.ink, textAlign: 'center' },
    emptyText: { fontSize: 14, color: Brand.muted, textAlign: 'center' },
    pickerRow: { gap: 8 },
    pickerChip: {
        minHeight: 44,
        maxWidth: 240,
        paddingHorizontal: 16,
        justifyContent: 'center',
        borderRadius: 22,
        backgroundColor: Brand.chipLight,
    },
    pickerChipActive: { backgroundColor: Brand.greenDeep },
    pickerText: { fontSize: 14, fontWeight: '600', color: Brand.greenDeep },
    pickerTextActive: { color: '#fff' },
    card: {
        backgroundColor: Brand.card,
        borderRadius: Radius.card,
        borderWidth: 1,
        borderColor: Brand.line,
        padding: 16,
        gap: 10,
    },
    cardLabel: { fontSize: 13, fontWeight: '600', color: Brand.muted },
    goalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
    goalValue: { fontSize: 44, fontWeight: '800', color: Brand.ink },
    goalOf: { fontSize: 16, color: Brand.muted },
    track: { height: 8, borderRadius: 4, backgroundColor: Brand.trackLight, overflow: 'hidden' },
    fill: { height: 8, borderRadius: 4, backgroundColor: Brand.green },
    goalHint: { fontSize: 14, color: Brand.ink },
    mapBox: { height: 240, borderRadius: 16, overflow: 'hidden', backgroundColor: Brand.chipGray },
    map: { flex: 1 },
    mapPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    locateButton: {
        position: 'absolute',
        right: 10,
        bottom: 10,
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Brand.card,
        borderWidth: 1,
        borderColor: Brand.line,
    },
    statusBlock: { gap: 4 },
    statusStrong: { fontSize: 14, fontWeight: '700', color: Brand.ink },
    statusText: { fontSize: 14, color: Brand.muted },
    linkButton: { minHeight: 44, justifyContent: 'center' },
    linkText: { fontSize: 14, fontWeight: '700', color: Brand.greenDeep, textDecorationLine: 'underline' },
    primaryButton: {
        minHeight: 56,
        borderRadius: Radius.card,
        backgroundColor: Brand.forest,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: 20,
        paddingVertical: 12,
    },
    pressed: { opacity: 0.85 },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    entry: {
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: Brand.line,
    },
    entryTime: { fontSize: 16, fontWeight: '700', color: Brand.ink, minWidth: 52 },
    entryBody: { flex: 1 },
    entryStatus: { fontSize: 14, color: Brand.ink },
    entryMeta: { fontSize: 12, color: Brand.muted },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Brand.muted },
});

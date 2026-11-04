import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
    CalendarDays,
    CheckCircle2,
    Clock,
    Download,
    PenLine,
    PlayCircle,
    RefreshCw,
    ShieldOff,
    Trash2,
    Users,
    WifiOff,
} from 'lucide-react-native';
import Chip from '@/components/Chip';
import PressableScale from '@/components/home/PressableScale';
import ProgressBar from '@/components/home/ProgressBar';
import { Brand } from '@/constants/brand';
import { formatApiDate, parseApiDate } from '@/lib/formatDate';

interface PesquisaCardProps {
    titulo: string;
    targetAudience: string;
    startDate: string;
    endDate: string;
    isDownloaded: boolean;
    isOnline: boolean;
    isDownloading: boolean;
    coletasCount?: number;
    draftCount?: number;
    revoked?: boolean;
    /** Progresso frente à meta; `target` nulo = sem meta definida. */
    progress?: { done: number; target: number | null; percent: number | null; pending: number };
    /** Atraso da barra de progresso, para encher em sequência com os outros cartões. */
    delay?: number;
    onDownload: () => void;
    onReturn?: () => void;
    onStart?: () => void;
    onResume?: () => void;
}

const DAY = 24 * 60 * 60 * 1000;

/** Quanto falta para a pesquisa encerrar, em texto curto. `urgent` quando restam poucos dias. */
function deadline(endDate: string): { text: string; urgent: boolean } | null {
    const end = parseApiDate(endDate);
    if (!end) return null;
    const endOfDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59).getTime();
    const days = Math.ceil((endOfDay - Date.now()) / DAY) - 1;
    if (days < 0) return { text: 'Vigência encerrada', urgent: true };
    if (days === 0) return { text: 'Encerra hoje', urgent: true };
    if (days === 1) return { text: 'Encerra amanhã', urgent: true };
    if (days <= 7) return { text: `Encerra em ${days} dias`, urgent: true };
    return { text: `Encerra em ${days} dias`, urgent: false };
}

/** Card de uma pesquisa na lista do pesquisador, com os dados, o progresso e as ações. */
export default function PesquisaCard({
    titulo,
    targetAudience,
    startDate,
    endDate,
    isDownloaded,
    isOnline,
    isDownloading,
    coletasCount = 0,
    draftCount = 0,
    revoked = false,
    progress,
    delay = 0,
    onDownload,
    onReturn,
    onStart,
    onResume,
}: PesquisaCardProps) {
    const period = `${formatApiDate(startDate)} a ${formatApiDate(endDate)}`;
    const canDownload = isOnline && !isDownloading && !revoked;
    const left = revoked ? null : deadline(endDate);
    const hasGoal = !!progress && progress.percent !== null;
    const complete = hasGoal && (progress?.percent ?? 0) >= 100;

    const iconTone = revoked ? 'clay' : isDownloaded ? 'green' : 'gray';
    const StatusIcon = revoked ? ShieldOff : isDownloaded ? CheckCircle2 : Download;
    const iconColor = revoked ? Brand.clayInk : isDownloaded ? Brand.greenDeep : Brand.muted;

    return (
        <View style={[styles.card, revoked && styles.cardRevoked]}>
            <View style={styles.top}>
                <View style={[styles.iconPill, iconPillTone[iconTone]]}>
                    <StatusIcon size={22} color={iconColor} strokeWidth={1.8} />
                </View>
                <View style={styles.titles}>
                    <Text style={styles.title} numberOfLines={2}>
                        {titulo}
                    </Text>
                    <Chip
                        label={revoked ? 'Acesso revogado' : isDownloaded ? 'No aparelho' : 'Não baixada'}
                        tone={revoked ? 'clay' : isDownloaded ? 'light' : 'gray'}
                    />
                </View>
            </View>

            <View style={styles.meta}>
                <View style={styles.metaRow}>
                    <CalendarDays size={15} color={Brand.muted} strokeWidth={1.8} />
                    <Text style={styles.metaText}>{period}</Text>
                </View>
                {targetAudience ? (
                    <View style={styles.metaRow}>
                        <Users size={15} color={Brand.muted} strokeWidth={1.8} />
                        <Text style={styles.metaText} numberOfLines={2}>
                            {targetAudience}
                        </Text>
                    </View>
                ) : null}
                {left ? (
                    <View style={[styles.deadline, left.urgent && styles.deadlineUrgent]}>
                        <Clock size={12} color={left.urgent ? Brand.clayInk : Brand.greenDeep} strokeWidth={2} />
                        <Text style={[styles.deadlineText, left.urgent && styles.deadlineTextUrgent]}>{left.text}</Text>
                    </View>
                ) : null}
            </View>

            {isDownloaded ? (
                <>
                    {hasGoal && progress ? (
                        <View style={styles.goal}>
                            <View style={styles.goalTop}>
                                <Text style={styles.goalLabel}>Meta</Text>
                                <Text style={[styles.goalPercent, complete && styles.goalPercentDone]}>
                                    {progress.percent}%
                                </Text>
                            </View>
                            <ProgressBar
                                percent={progress.percent ?? 0}
                                delay={delay}
                                color={complete ? Brand.greenDeep : Brand.green}
                            />
                            <Text style={styles.goalCaption}>
                                {complete
                                    ? `Meta atingida · ${progress.done} ${progress.done === 1 ? 'coleta' : 'coletas'}`
                                    : `${progress.done} de ${progress.target} · faltam ${Math.max(0, (progress.target ?? 0) - progress.done)}`}
                                {progress.pending > 0 ? ` · ${progress.pending} aguardando envio` : ''}
                            </Text>
                        </View>
                    ) : null}

                    <View style={styles.tiles}>
                        <View style={styles.tile}>
                            <View style={styles.tileTop}>
                                <CheckCircle2 size={14} color={Brand.greenDeep} strokeWidth={2} />
                                <Text style={styles.tileLabel}>{coletasCount === 1 ? 'coleta feita' : 'coletas feitas'}</Text>
                            </View>
                            <Text style={styles.tileValue}>{coletasCount}</Text>
                        </View>
                        <View style={[styles.tile, draftCount > 0 && styles.tileClay]}>
                            <View style={styles.tileTop}>
                                <PenLine size={14} color={draftCount > 0 ? Brand.clayInk : Brand.greenDeep} strokeWidth={2} />
                                <Text style={[styles.tileLabel, draftCount > 0 && styles.tileLabelClay]}>
                                    {draftCount === 1 ? 'rascunho' : 'rascunhos'}
                                </Text>
                            </View>
                            <Text style={[styles.tileValue, draftCount > 0 && styles.tileValueClay]}>{draftCount}</Text>
                        </View>
                    </View>

                    <View style={styles.actions}>
                        {draftCount > 0 ? (
                            <PressableScale
                                onPress={onResume}
                                accessibilityRole="button"
                                accessibilityLabel={`Retomar rascunho de ${titulo}`}
                                containerStyle={styles.flex}
                                style={[styles.button, styles.buttonGhost]}
                            >
                                <Text style={styles.buttonGhostText}>Retomar</Text>
                            </PressableScale>
                        ) : null}
                        <PressableScale
                            onPress={onStart}
                            accessibilityRole="button"
                            accessibilityLabel={`Iniciar coleta de ${titulo}`}
                            containerStyle={styles.flex}
                            style={[styles.button, styles.buttonPrimary]}
                        >
                            <PlayCircle size={18} color="#fff" strokeWidth={1.8} />
                            <Text style={styles.buttonPrimaryText}>Iniciar coleta</Text>
                        </PressableScale>
                        {isOnline ? (
                            <PressableScale
                                onPress={onDownload}
                                disabled={isDownloading}
                                accessibilityRole="button"
                                accessibilityLabel={`Atualizar a pesquisa ${titulo}`}
                                style={styles.iconButton}
                            >
                                {isDownloading ? (
                                    <ActivityIndicator size="small" color={Brand.green} />
                                ) : (
                                    <RefreshCw size={18} color={Brand.greenDeep} strokeWidth={1.8} />
                                )}
                            </PressableScale>
                        ) : null}
                    </View>

                    {onReturn ? (
                        <PressableScale
                            onPress={onReturn}
                            accessibilityRole="button"
                            accessibilityLabel={`Remover a pesquisa ${titulo} do aparelho`}
                            scaleTo={0.96}
                            style={styles.returnLink}
                        >
                            <Trash2 size={15} color={Brand.muted} strokeWidth={1.8} />
                            <Text style={styles.returnLinkText}>Remover do aparelho</Text>
                        </PressableScale>
                    ) : null}
                </>
            ) : (
                <PressableScale
                    onPress={onDownload}
                    disabled={!canDownload}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canDownload, busy: isDownloading }}
                    accessibilityLabel={`Baixar a pesquisa ${titulo}`}
                    style={[styles.button, styles.buttonMint, !canDownload && styles.buttonDisabled]}
                >
                    {isDownloading ? (
                        <ActivityIndicator size="small" color={Brand.forest} />
                    ) : (
                        <>
                            {!isOnline ? (
                                <WifiOff size={18} color={Brand.muted} strokeWidth={1.8} />
                            ) : revoked ? (
                                <ShieldOff size={18} color={Brand.muted} strokeWidth={1.8} />
                            ) : (
                                <Download size={18} color={Brand.forest} strokeWidth={1.8} />
                            )}
                            <Text style={[styles.buttonMintText, !canDownload && styles.buttonDisabledText]}>
                                {revoked
                                    ? 'Acesso revogado neste aparelho'
                                    : !isOnline
                                        ? 'Precisa de internet para baixar'
                                        : 'Baixar pesquisa'}
                            </Text>
                        </>
                    )}
                </PressableScale>
            )}
        </View>
    );
}

/** Cores de fundo do ícone, por tom. */
const iconPillTone = StyleSheet.create({
    green: { backgroundColor: Brand.chipLight },
    gray: { backgroundColor: Brand.chipGray },
    clay: { backgroundColor: Brand.clayLight },
});

const styles = StyleSheet.create({
    flex: { flex: 1 },
    card: {
        backgroundColor: Brand.card,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: Brand.line,
        padding: 16,
        gap: 14,
    },
    cardRevoked: { backgroundColor: '#fbf3ef', borderColor: 'rgba(171, 96, 73, 0.3)' },
    top: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    iconPill: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    titles: { flex: 1, minWidth: 0, gap: 8 },
    title: { fontSize: 18, fontWeight: '600', letterSpacing: -0.4, color: Brand.ink },
    meta: { gap: 8 },
    metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    metaText: { flex: 1, fontSize: 13.5, lineHeight: 18, color: Brand.muted },
    deadline: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        height: 24,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: Brand.chipLight,
    },
    deadlineUrgent: { backgroundColor: Brand.clayLight },
    deadlineText: { fontSize: 12, fontWeight: '600', color: Brand.greenDeep },
    deadlineTextUrgent: { color: Brand.clayInk },
    goal: { gap: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: Brand.line },
    goalTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    goalLabel: { fontSize: 13, fontWeight: '600', color: Brand.ink },
    goalPercent: { fontSize: 22, fontWeight: '300', letterSpacing: -0.8, color: Brand.ink, fontVariant: ['tabular-nums'] },
    goalPercentDone: { color: Brand.greenDeep, fontWeight: '600' },
    goalCaption: { fontSize: 12, color: Brand.muted },
    tiles: { flexDirection: 'row', gap: 10 },
    tile: {
        flex: 1,
        gap: 4,
        padding: 12,
        borderRadius: 18,
        backgroundColor: Brand.chipLight,
    },
    tileClay: { backgroundColor: Brand.clayLight },
    tileTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tileLabel: { fontSize: 12, color: Brand.greenDeep },
    tileLabelClay: { color: Brand.clayInk },
    tileValue: { fontSize: 30, fontWeight: '300', letterSpacing: -1.2, color: Brand.ink, fontVariant: ['tabular-nums'] },
    tileValueClay: { color: Brand.clayInk },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    button: {
        minHeight: 48,
        borderRadius: 999,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: 18,
    },
    buttonPrimary: { backgroundColor: Brand.ink },
    buttonPrimaryText: { color: '#fff', fontWeight: '500', fontSize: 15 },
    buttonGhost: { borderWidth: 1, borderColor: '#cdd5d0', backgroundColor: 'transparent' },
    buttonGhostText: { color: Brand.ink, fontWeight: '500', fontSize: 15 },
    buttonMint: { backgroundColor: Brand.mint },
    buttonMintText: { color: Brand.forest, fontWeight: '500', fontSize: 15 },
    buttonDisabled: { backgroundColor: Brand.chipGray },
    buttonDisabledText: { color: Brand.muted },
    iconButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: '#cdd5d0',
        alignItems: 'center',
        justifyContent: 'center',
    },
    returnLink: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 4,
    },
    returnLinkText: { fontSize: 13.5, color: Brand.muted },
});

import { CheckCircle2, Download, PenLine, Trash2 } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import Chip from '@/components/Chip';
import CountUp from '@/components/home/CountUp';
import PressableScale from '@/components/home/PressableScale';
import ProgressBar from '@/components/home/ProgressBar';
import { Brand } from '@/constants/brand';
import type { ResearchProgress } from '@/lib/researchProgress';

interface ResearchProgressCardProps {
    titulo: string;
    isDownloaded: boolean;
    progress: ResearchProgress;
    drafts: number;
    delay?: number;
    // Só nas pesquisas baixadas. Bloqueado enquanto houver coleta pendente (a tela explica ao tocar).
    onRemove?: () => void;
    removeBlocked?: boolean;
}

/** Escreve o número com a palavra no singular ou no plural. */
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Progresso do pesquisador frente à meta de uma pesquisa, com a remoção dela do aparelho. */
export default function ResearchProgressCard({
    titulo,
    isDownloaded,
    progress,
    drafts,
    delay = 0,
    onRemove,
    removeBlocked,
}: ResearchProgressCardProps) {
    const { done, pending, target, remaining, percent } = progress;
    const complete = percent !== null && percent >= 100;
    const StatusIcon = isDownloaded ? CheckCircle2 : Download;

    return (
        <View style={styles.card}>
            <View style={styles.top}>
                <View style={[styles.iconPill, { backgroundColor: isDownloaded ? Brand.chipLight : Brand.chipGray }]}>
                    <StatusIcon size={20} color={isDownloaded ? Brand.greenDeep : Brand.muted} strokeWidth={1.8} />
                </View>
                <View style={styles.titles}>
                    <Text style={styles.title} numberOfLines={2}>
                        {titulo}
                    </Text>
                    <Chip label={isDownloaded ? 'No aparelho' : 'Não baixada'} tone={isDownloaded ? 'light' : 'gray'} />
                </View>
                {percent !== null ? (
                    <Text style={[styles.percent, complete && styles.percentDone]}>{percent}%</Text>
                ) : null}
            </View>

            <View style={styles.numbers}>
                <CountUp value={done} style={styles.big} />
                <Text style={styles.of}>
                    {target !== null ? `de ${target} ${target === 1 ? 'coleta' : 'coletas'}` : done === 1 ? 'coleta feita' : 'coletas feitas'}
                </Text>
            </View>

            {target !== null && percent !== null && remaining !== null ? (
                <View
                    style={styles.progress}
                    accessibilityRole="progressbar"
                    accessibilityLabel={`Meta de ${titulo}`}
                    accessibilityValue={{ min: 0, max: target, now: Math.min(done, target) }}
                >
                    <ProgressBar percent={percent} delay={delay} color={complete ? Brand.greenDeep : Brand.green} />
                    <Text style={styles.detail}>
                        {remaining === 0
                            ? 'Meta atingida'
                            : `Faltam ${plural(remaining, 'coleta', 'coletas')} para a meta`}
                    </Text>
                </View>
            ) : (
                <Text style={styles.detail}>Sem meta definida pelo administrador.</Text>
            )}

            {pending > 0 || drafts > 0 ? (
                <View style={styles.badges}>
                    {pending > 0 ? (
                        <View style={[styles.badge, styles.badgeClay]}>
                            <CheckCircle2 size={13} color={Brand.clayInk} strokeWidth={2} />
                            <Text style={[styles.badgeText, styles.badgeTextClay]}>
                                {plural(pending, 'aguardando envio', 'aguardando envio')}
                            </Text>
                        </View>
                    ) : null}
                    {drafts > 0 ? (
                        <View style={styles.badge}>
                            <PenLine size={13} color={Brand.greenDeep} strokeWidth={2} />
                            <Text style={styles.badgeText}>
                                {plural(drafts, 'rascunho (não conta na meta)', 'rascunhos (não contam na meta)')}
                            </Text>
                        </View>
                    ) : null}
                </View>
            ) : null}

            {onRemove ? (
                <View style={styles.removeBox}>
                    <PressableScale
                        onPress={onRemove}
                        scaleTo={0.96}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !!removeBlocked }}
                        accessibilityLabel={`Remover a pesquisa ${titulo} do aparelho`}
                        style={[styles.removeButton, removeBlocked && styles.removeBlocked]}
                    >
                        <Trash2 size={14} color={removeBlocked ? Brand.muted : Brand.clayInk} strokeWidth={1.8} />
                        <Text style={[styles.removeText, removeBlocked && styles.removeTextBlocked]}>Remover do aparelho</Text>
                    </PressableScale>
                    {removeBlocked ? (
                        <Text style={styles.removeHint}>Disponível quando a fila desta pesquisa estiver vazia.</Text>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: Brand.card,
        borderWidth: 1,
        borderColor: Brand.line,
        borderRadius: 24,
        padding: 16,
        gap: 10,
    },
    top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    iconPill: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    titles: { flex: 1, minWidth: 0, gap: 6 },
    title: { fontSize: 16, fontWeight: '600', letterSpacing: -0.3, color: Brand.ink },
    percent: { fontSize: 22, fontWeight: '300', letterSpacing: -0.8, color: Brand.ink, fontVariant: ['tabular-nums'] },
    percentDone: { color: Brand.greenDeep, fontWeight: '600' },
    numbers: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2 },
    big: { fontSize: 38, fontWeight: '300', letterSpacing: -1.8, color: Brand.ink, fontVariant: ['tabular-nums'] },
    of: { fontSize: 14, color: Brand.muted },
    progress: { gap: 8 },
    detail: { fontSize: 13, color: Brand.muted },
    badges: { gap: 6 },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: Brand.chipLight,
    },
    badgeClay: { backgroundColor: Brand.clayLight },
    badgeText: { flexShrink: 1, fontSize: 12, fontWeight: '500', color: Brand.greenDeep },
    badgeTextClay: { color: Brand.clayInk },
    removeBox: { marginTop: 4, gap: 6, borderTopWidth: 1, borderTopColor: Brand.line, paddingTop: 12 },
    removeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 6,
        paddingHorizontal: 16,
        height: 40,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#e9c5b9',
    },
    removeBlocked: { borderColor: '#cdd5d0' },
    removeText: { fontSize: 13, fontWeight: '500', color: Brand.clayInk },
    removeTextBlocked: { color: Brand.muted },
    removeHint: { fontSize: 12, color: Brand.muted },
});

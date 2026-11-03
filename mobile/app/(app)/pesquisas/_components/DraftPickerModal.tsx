import { ChevronRight, Trash2 } from 'lucide-react-native';
import React from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { LocalCollection } from '@/lib/collectionStore';
import { isAnswerEmpty } from '@/lib/displayRules';
import { formatRelativeTime, type DraftProgress } from '@/lib/draftProgress';
import { Brand } from '@/constants/brand';
import { t, tp } from '@/i18n';

interface DraftPickerModalProps {
    visible: boolean;
    title: string;
    /** Rascunhos da pesquisa, já ordenados (o mais recente primeiro). */
    drafts: LocalCollection[];
    /** Progresso de cada rascunho (por clientId). Sem o pacote da pesquisa no aparelho, o rascunho fica sem barra. */
    progress?: Record<string, DraftProgress>;
    onSelect: (draft: LocalCollection) => void;
    /** Pedido para apagar o rascunho. Quem chama confirma com a pessoa e apaga. */
    onDiscard?: (draft: LocalCollection) => void;
    onClose: () => void;
}

function formatDateTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return t('drafts.dateTime', {
        date: date.toLocaleDateString('pt-BR'),
        time: date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    });
}

const answeredCount = (draft: LocalCollection) =>
    Object.values(draft.answers).filter((value) => !isAnswerEmpty(value)).length;

/** Lista os rascunhos de uma pesquisa para o pesquisador escolher qual continuar editando. */
export default function DraftPickerModal({ visible, title, drafts, progress, onSelect, onDiscard, onClose }: DraftPickerModalProps) {
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                {/* Pressable interno: tocar dentro da folha não fecha o modal */}
                <Pressable style={styles.sheet} onPress={() => undefined}>
                    <Text style={styles.title}>{t('drafts.pickTitle')}</Text>
                    <Text style={styles.subtitle} numberOfLines={2}>
                        {tp('drafts.pickSubtitle', drafts.length, { title })}
                    </Text>

                    <FlatList
                        data={drafts}
                        keyExtractor={(draft) => draft.clientId}
                        style={styles.list}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        renderItem={({ item, index }) => {
                            const count = answeredCount(item);
                            const info = progress?.[item.clientId];
                            const ratio = info && info.total > 0 ? Math.min(1, info.answered / info.total) : null;
                            return (
                                <View style={styles.item}>
                                    <TouchableOpacity
                                        style={styles.itemMain}
                                        onPress={() => onSelect(item)}
                                        activeOpacity={0.7}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('drafts.continueA11y', {
                                            date: formatDateTime(item.startedAt),
                                            progress: info ? tp('drafts.progress', info.total, { answered: info.answered }) : tp('drafts.answered', count),
                                        })}
                                    >
                                        <View style={styles.itemInfo}>
                                            <View style={styles.itemHead}>
                                                <Text style={styles.itemTitle}>{t('drafts.edited', { when: formatRelativeTime(item.updatedAt) })}</Text>
                                                {index === 0 ? <Text style={styles.itemRecent}>{t('drafts.latest')}</Text> : null}
                                            </View>
                                            <Text style={styles.itemText}>{t('drafts.started', { date: formatDateTime(item.startedAt) })}</Text>

                                            {ratio !== null && info ? (
                                                <>
                                                    <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                                                        <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
                                                    </View>
                                                    <Text style={styles.itemCount}>
                                                        {tp('drafts.progress', info.total, { answered: info.answered })}
                                                    </Text>
                                                </>
                                            ) : (
                                                <Text style={styles.itemCount}>
                                                    {tp('drafts.answered', count)}
                                                </Text>
                                            )}
                                        </View>
                                        <ChevronRight size={20} color={Brand.green} />
                                    </TouchableOpacity>

                                    {onDiscard ? (
                                        <TouchableOpacity
                                            style={styles.discard}
                                            onPress={() => onDiscard(item)}
                                            hitSlop={8}
                                            accessibilityRole="button"
                                            accessibilityLabel={t('drafts.discard')}
                                        >
                                            <Trash2 size={18} color={Brand.clayInk} strokeWidth={1.8} />
                                        </TouchableOpacity>
                                    ) : null}
                                </View>
                            );
                        }}
                    />

                    <TouchableOpacity style={styles.cancel} onPress={onClose}>
                        <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                    </TouchableOpacity>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(10,20,16,0.55)', justifyContent: 'flex-end' },
    sheet: {
        backgroundColor: Brand.card,
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        padding: 22,
        maxHeight: '80%',
    },
    title: { fontSize: 22, fontWeight: '600', letterSpacing: -0.6, color: Brand.ink },
    subtitle: { fontSize: 14, color: Brand.muted, marginTop: 4, marginBottom: 14 },
    list: { flexGrow: 0 },
    listContent: { gap: 10, paddingBottom: 4 },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: Brand.line,
        borderRadius: 20,
        backgroundColor: Brand.paper,
    },
    itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15 },
    itemHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    itemInfo: { flex: 1, gap: 2 },
    track: { height: 6, borderRadius: 3, backgroundColor: Brand.trackLight, overflow: 'hidden', marginTop: 8 },
    fill: { height: 6, borderRadius: 3, backgroundColor: Brand.green },
    discard: { width: 48, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: Brand.line },
    itemTitle: { fontSize: 15, fontWeight: '600', color: Brand.ink },
    itemRecent: { fontSize: 11.5, color: Brand.clayInk, fontWeight: '700', backgroundColor: Brand.clayLight, paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999, overflow: 'hidden' },
    itemText: { fontSize: 13, color: Brand.muted },
    itemCount: { fontSize: 13.5, color: Brand.greenDeep, fontWeight: '600', marginTop: 2 },
    cancel: {
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 46,
        marginTop: 12,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#cdd5d0',
    },
    cancelText: { fontSize: 15, color: Brand.ink, fontWeight: '500' },
});

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, CloudUpload, RotateCw, Trash2 } from 'lucide-react-native';
import Chip from '@/components/Chip';
import PressableScale from '@/components/home/PressableScale';
import { Brand } from '@/constants/brand';

export type SyncCardStatus = 'pendente' | 'aguardando' | 'enviando' | 'falha' | 'sincronizado';

interface SyncCardProps {
    identificador: string;
    pesquisa: string;
    data: string;
    // Só nas enviadas: quando o servidor confirmou o recebimento
    enviadaEm?: string;
    status: SyncCardStatus;
    // Só na falha: por que o servidor não confirmou, quantas vezes já falhou e o botão de reenviar
    motivo?: string;
    tentativas?: number;
    onRetry?: () => void;
    retryDisabled?: boolean;
    // Só quando o servidor recusou de vez: apaga a coleta do aparelho (a tela pede confirmação)
    onDiscard?: () => void;
    discardDisabled?: boolean;
}

/** Card de uma coleta na tela de sincronização, com a situação e as ações. */
export default function SyncCard({
    identificador,
    pesquisa,
    data,
    enviadaEm,
    status,
    motivo,
    tentativas,
    onRetry,
    retryDisabled,
    onDiscard,
    discardDisabled,
}: SyncCardProps) {
    const renderStatus = () => {
        switch (status) {
            case 'sincronizado':
                return <Chip label="Enviada" tone="light" />;
            case 'enviando':
                return (
                    <View style={styles.sending}>
                        <ActivityIndicator size="small" color={Brand.green} />
                        <Text style={styles.sendingText}>Enviando</Text>
                    </View>
                );
            case 'aguardando':
                return <Chip label="Na fila" tone="gray" />;
            case 'pendente':
                return <Chip label="Pendente" tone="clay" />;
            default:
                return <Chip label="Falhou" tone="clay" />;
        }
    };

    const failed = status === 'falha';
    const done = status === 'sincronizado';
    const Icon = done ? CheckCircle2 : failed ? AlertTriangle : status === 'enviando' ? CloudUpload : Clock;
    const iconColor = failed || status === 'pendente' ? Brand.clayInk : done || status === 'enviando' ? Brand.greenDeep : Brand.muted;
    const iconBg = failed || status === 'pendente' ? Brand.clayLight : done || status === 'enviando' ? Brand.chipLight : Brand.chipGray;

    return (
        <View style={[styles.card, failed && styles.cardFailed]}>
            <View style={styles.cardContent}>
                <View style={[styles.iconPill, { backgroundColor: iconBg }]}>
                    <Icon size={20} color={iconColor} strokeWidth={1.8} />
                </View>
                <View style={styles.cardInfo}>
                    <Text style={styles.itemTitle}>{identificador}</Text>
                    <Text style={styles.itemSubtitle} numberOfLines={2}>
                        {pesquisa}
                    </Text>
                    <View style={styles.dateRow}>
                        <CalendarClock size={13} color={Brand.muted} strokeWidth={1.8} />
                        <Text style={styles.itemDate}>Coletada em {data}</Text>
                    </View>
                    {enviadaEm ? (
                        <View style={styles.dateRow}>
                            <CheckCircle2 size={13} color={Brand.greenDeep} strokeWidth={1.8} />
                            <Text style={styles.itemSent}>Enviada em {enviadaEm}</Text>
                        </View>
                    ) : null}
                </View>
                {renderStatus()}
            </View>

            {failed ? (
                <View style={styles.failure}>
                    <Text style={styles.failureReason}>{motivo ?? 'O envio não foi concluído.'}</Text>
                    {tentativas ? (
                        <Text style={styles.failureAttempts}>
                            {tentativas === 1 ? '1 tentativa sem sucesso' : `${tentativas} tentativas sem sucesso`}
                        </Text>
                    ) : null}
                    <View style={styles.actions}>
                        {onRetry ? (
                            <PressableScale
                                onPress={onRetry}
                                disabled={retryDisabled}
                                accessibilityRole="button"
                                accessibilityLabel={`Tentar enviar de novo a ${identificador}`}
                                accessibilityState={{ disabled: !!retryDisabled }}
                                style={[styles.retryButton, retryDisabled && styles.disabled]}
                            >
                                <RotateCw size={14} color={Brand.greenDeep} strokeWidth={1.8} />
                                <Text style={styles.retryText}>Tentar de novo</Text>
                            </PressableScale>
                        ) : null}
                        {onDiscard ? (
                            <PressableScale
                                onPress={onDiscard}
                                disabled={discardDisabled}
                                accessibilityRole="button"
                                accessibilityLabel={`Descartar a ${identificador}, apagando do aparelho`}
                                accessibilityState={{ disabled: !!discardDisabled }}
                                style={[styles.discardButton, discardDisabled && styles.disabled]}
                            >
                                <Trash2 size={14} color={Brand.clayInk} strokeWidth={1.8} />
                                <Text style={styles.discardText}>Descartar coleta</Text>
                            </PressableScale>
                        ) : null}
                    </View>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: 22,
        padding: 14,
        borderWidth: 1,
        borderColor: Brand.line,
        backgroundColor: Brand.card,
    },
    cardFailed: { borderColor: 'rgba(171, 96, 73, 0.3)', backgroundColor: '#fbf3ef' },
    cardContent: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    iconPill: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    cardInfo: { flex: 1, minWidth: 0, gap: 2 },
    itemTitle: { fontSize: 16, fontWeight: '600', letterSpacing: -0.3, color: Brand.ink },
    itemSubtitle: { fontSize: 13.5, color: Brand.greenDeep, fontWeight: '500' },
    dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
    itemDate: { fontSize: 12.5, color: Brand.muted },
    itemSent: { fontSize: 12.5, color: Brand.greenDeep },
    sending: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 26,
        paddingHorizontal: 11,
        borderRadius: 999,
        backgroundColor: Brand.chipLight,
    },
    sendingText: { fontSize: 12, fontWeight: '500', color: Brand.greenDeep },
    failure: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(171, 96, 73, 0.22)',
        gap: 4,
    },
    failureReason: { fontSize: 13, color: Brand.clayInk, lineHeight: 18 },
    failureAttempts: { fontSize: 12, color: Brand.muted },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    retryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 16,
        height: 40,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#cdd5d0',
        backgroundColor: Brand.card,
    },
    discardButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 16,
        height: 40,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#e9c5b9',
    },
    discardText: { fontSize: 13, fontWeight: '500', color: Brand.clayInk },
    disabled: { opacity: 0.45 },
    retryText: { fontSize: 13, fontWeight: '500', color: Brand.ink },
});

import { AlertTriangle, Mic, PauseCircle } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatClock } from '@/lib/audioStorage';

interface RecordingStatusBannerProps {
    isRecording: boolean;
    seconds: number;
    /** A gravação da entrevista está em pausa porque o pesquisador grava uma resposta por voz. */
    pausedForAnswer: boolean;
    /** Gravação que parou sem o pesquisador pedir (ligação, falta de espaço...). */
    interrupted: { at: string; message: string } | null;
    lowSpace: boolean;
    /** Sem permissão de notificações a gravação só continua com o app aberto. */
    foregroundOnly: boolean;
    onResume: () => void;
}

/**
 * Faixa fixa da tela de coleta: mostra que a entrevista está sendo gravada e, principalmente,
 * avisa na hora quando a gravação parou — o app nunca finge que está gravando.
 */
export default function RecordingStatusBanner({
    isRecording,
    seconds,
    pausedForAnswer,
    interrupted,
    lowSpace,
    foregroundOnly,
    onResume,
}: RecordingStatusBannerProps) {
    if (!isRecording && !interrupted) return null;

    return (
        <View style={styles.wrapper}>
            {interrupted ? (
                <View style={[styles.box, styles.danger]} accessibilityRole="alert">
                    <View style={styles.row}>
                        <AlertTriangle size={18} color="#b91c1c" />
                        <Text style={styles.dangerTitle}>
                            Gravação interrompida às {new Date(interrupted.at).toLocaleTimeString('pt-BR')}
                        </Text>
                    </View>
                    <Text style={styles.dangerText}>{interrupted.message}</Text>
                    <TouchableOpacity style={styles.resumeButton} onPress={onResume} accessibilityRole="button">
                        <Mic size={16} color="#fff" />
                        <Text style={styles.resumeText}>Retomar gravação</Text>
                    </TouchableOpacity>
                </View>
            ) : pausedForAnswer ? (
                <View style={[styles.box, styles.neutral]}>
                    <View style={styles.row}>
                        <PauseCircle size={16} color="#52525b" />
                        <Text style={styles.neutralText}>
                            Gravação da entrevista em pausa enquanto você grava a resposta por voz. Ela volta sozinha.
                        </Text>
                    </View>
                </View>
            ) : (
                <View style={[styles.box, styles.ok]}>
                    <View style={styles.row}>
                        <View style={styles.dot} />
                        <Text style={styles.okText}>Gravando a entrevista · {formatClock(seconds)}</Text>
                    </View>
                </View>
            )}

            {lowSpace && !interrupted ? (
                <View style={[styles.box, styles.warn]}>
                    <Text style={styles.warnText}>
                        Pouco espaço livre no aparelho. Libere espaço ou a gravação pode parar.
                    </Text>
                </View>
            ) : null}

            {foregroundOnly && !interrupted ? (
                <View style={[styles.box, styles.warn]}>
                    <Text style={styles.warnText}>
                        Sem a permissão de notificações, a gravação só continua com o app aberto. Não troque de app
                        nem bloqueie a tela.
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: { gap: 6, paddingHorizontal: 16, paddingTop: 8 },
    box: { borderRadius: 8, padding: 10, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    ok: { backgroundColor: '#e8f1ed' },
    okText: { fontSize: 13, color: '#447762', fontWeight: '600' },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#b91c1c' },
    neutral: { backgroundColor: '#f4f4f5' },
    neutralText: { flex: 1, fontSize: 13, color: '#52525b' },
    danger: { backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#b91c1c' },
    dangerTitle: { flex: 1, fontSize: 14, color: '#b91c1c', fontWeight: 'bold' },
    dangerText: { fontSize: 13, color: '#7f1d1d', lineHeight: 18 },
    resumeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: '#b91c1c',
        borderRadius: 8,
        paddingVertical: 10,
    },
    resumeText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
    warn: { backgroundColor: '#fef3c7' },
    warnText: { fontSize: 13, color: '#92400e', lineHeight: 18 },
});

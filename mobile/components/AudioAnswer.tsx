import {
    setAudioModeAsync,
    useAudioPlayer,
    useAudioPlayerStatus,
    useAudioRecorder,
    useAudioRecorderState,
} from 'expo-audio';
import { Mic, Pause, Play, RotateCcw, Settings, Square } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
    ensureMicPermission,
    formatClock,
    getFreeSpaceBytes,
    keepAnswerAudio,
    MIN_SPACE_TO_RECORD_BYTES,
} from '@/lib/audioStorage';
import type { AnswerValue, PackageQuestion } from '@/lib/displayRules';
import { getAudioMaxSeconds, parseAudioAnswer, serializeAudioAnswer } from '@/lib/questionTypes';
import { VOICE_RECORDING_OPTIONS } from '@/lib/recordingOptions';

/**
 * Ligação entre a questão de áudio e a gravação da entrevista inteira (quando a pesquisa grava).
 * O microfone atende uma gravação por vez: a da entrevista fica em pausa durante a resposta.
 */
export interface AudioBridge {
    /** Avisa a tela que está gravando (ela trava "Avançar", "Voltar" e "Salvar e sair"). */
    onBusyChange: (busy: boolean) => void;
    pauseInterview: () => Promise<void>;
    resumeInterview: () => Promise<void>;
    /** A entrevista está sendo gravada: o modo de áudio não pode ser desligado ao terminar. */
    interviewActive: boolean;
}

interface AudioAnswerProps {
    question: PackageQuestion;
    value: AnswerValue;
    onChange: (value: AnswerValue) => void;
    error: string | null;
    /** UUID da coleta: o áudio é guardado na pasta dela. */
    collectionId: string;
    audioBridge?: AudioBridge;
}

type Phase = 'idle' | 'recording' | 'saving';
type Problem =
    | { kind: 'denied'; canAskAgain: boolean }
    | { kind: 'error'; message: string }
    | { kind: 'cut'; message: string };

// Resposta falada: AAC mono 64 kbps, o mesmo padrão da gravação da entrevista (ver recordingOptions).
const ANSWER_OPTIONS = VOICE_RECORDING_OPTIONS;
const START_GRACE_MS = 2500;

/**
 * Questão "responda falando". Grava até a duração máxima cadastrada na web (para sozinha ao chegar
 * lá), deixa ouvir e regravar antes de avançar. O arquivo fica no aparelho e vai na fila de envio.
 */
export default function AudioAnswer({ question, value, onChange, error, collectionId, audioBridge }: AudioAnswerProps) {
    const maxSeconds = getAudioMaxSeconds(question);
    const answer = parseAudioAnswer(value);

    const recorder = useAudioRecorder(ANSWER_OPTIONS);
    const recorderState = useAudioRecorderState(recorder, 250);

    const [phase, setPhase] = useState<Phase>('idle');
    const [problem, setProblem] = useState<Problem | null>(null);

    const phaseRef = useRef<Phase>('idle');
    const startedAtRef = useRef(0);
    const bridgeRef = useRef(audioBridge);
    useEffect(() => {
        bridgeRef.current = audioBridge;
    });

    const changePhase = (next: Phase) => {
        phaseRef.current = next;
        setPhase(next);
    };

    const elapsed = Math.floor((recorderState.durationMillis ?? 0) / 1000);

    // Encerra a gravação, guarda o arquivo na pasta da coleta e põe a resposta. `note` explica
    // quando foi cortada (limite de tempo, ligação) para o pesquisador não achar que gravou tudo.
    const stopAndSave = async (note?: string) => {
        if (phaseRef.current !== 'recording') return;
        changePhase('saving');
        try {
            const before = recorder.getStatus().durationMillis ?? 0;
            await recorder.stop().catch(() => undefined);
            const seconds = Math.round(Math.max(before, recorder.getStatus().durationMillis ?? 0) / 1000);
            const tempUri = recorder.uri;

            if (!tempUri || seconds < 1) {
                setProblem({ kind: 'error', message: 'A gravação saiu vazia. Toque em "Gravar resposta" e tente de novo.' });
                return;
            }

            const kept = await keepAnswerAudio(tempUri, collectionId);
            onChange(serializeAudioAnswer({ uri: kept.uri, durationSeconds: Math.min(seconds, maxSeconds) }));
            if (note) setProblem({ kind: 'cut', message: note });
        } catch (error) {
            console.log('Falha ao guardar o áudio da resposta:', error);
            setProblem({ kind: 'error', message: 'Não foi possível guardar a gravação. Verifique o espaço do aparelho e tente de novo.' });
        } finally {
            await bridgeRef.current?.resumeInterview().catch(() => undefined);
            if (!bridgeRef.current?.interviewActive) {
                await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
            }
            bridgeRef.current?.onBusyChange(false);
            changePhase('idle');
        }
    };

    const startRecording = async () => {
        if (phaseRef.current !== 'idle') return;
        setProblem(null);

        const free = getFreeSpaceBytes();
        if (free !== null && free < MIN_SPACE_TO_RECORD_BYTES) {
            setProblem({ kind: 'error', message: 'Pouco espaço livre no aparelho para gravar. Libere espaço e tente de novo.' });
            return;
        }

        const permission = await ensureMicPermission();
        if (!permission.granted) {
            setProblem({ kind: 'denied', canAskAgain: permission.canAskAgain });
            return;
        }

        bridgeRef.current?.onBusyChange(true);
        try {
            await bridgeRef.current?.pauseInterview();
            await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
            await recorder.prepareToRecordAsync();
            recorder.record();
            startedAtRef.current = Date.now();
            changePhase('recording');
        } catch (error) {
            console.log('Falha ao iniciar a gravação da resposta:', error);
            await bridgeRef.current?.resumeInterview().catch(() => undefined);
            bridgeRef.current?.onBusyChange(false);
            setProblem({ kind: 'error', message: 'Não foi possível iniciar a gravação. Feche outros apps que usam o microfone e tente de novo.' });
        }
    };

    // Vigia a gravação: para sozinha ao chegar na duração máxima e, se ela parou sem o pesquisador
    // pedir (ligação, falta de espaço), guarda o que deu e avisa.
    useEffect(() => {
        if (phase !== 'recording') return;
        const timer = setInterval(() => {
            const status = recorder.getStatus();
            if ((status.durationMillis ?? 0) >= maxSeconds * 1000) {
                void stopAndSave(`Você chegou à duração máxima de ${formatClock(maxSeconds)}. A gravação parou sozinha.`);
                return;
            }
            if (Date.now() - startedAtRef.current < START_GRACE_MS) return;
            if (!status.isRecording) {
                void stopAndSave(
                    'A gravação foi interrompida (ligação, falta de espaço ou outro app usando o microfone). Foi guardado o que deu para gravar. Ouça e, se faltou algo, regrave.',
                );
            }
        }, 250);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, maxSeconds]);

    // Saiu da questão no meio da gravação: não deixa o microfone preso nem a entrevista em pausa
    useEffect(() => {
        return () => {
            if (phaseRef.current === 'recording') {
                void recorder.stop().catch(() => undefined);
                void bridgeRef.current?.resumeInterview().catch(() => undefined);
                bridgeRef.current?.onBusyChange(false);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const confirmRerecord = () => {
        Alert.alert('Regravar resposta', 'A gravação anterior será apagada do aparelho. Deseja gravar de novo?', [
            { text: 'Manter', style: 'cancel' },
            { text: 'Regravar', style: 'destructive', onPress: () => void startRecording() },
        ]);
    };

    const openSettings = () => {
        Linking.openSettings().catch(() => undefined);
    };

    const recording = phase === 'recording';
    const saving = phase === 'saving';

    return (
        <View style={styles.column}>
            <Text style={styles.hint}>Responda falando · duração máxima {formatClock(maxSeconds)}</Text>

            {recording ? (
                <View style={styles.recordingCard}>
                    <View style={styles.row}>
                        <View style={styles.dot} />
                        <Text style={styles.timer}>
                            {formatClock(elapsed)} / {formatClock(maxSeconds)}
                        </Text>
                    </View>
                    <View style={styles.track}>
                        <View style={[styles.fill, { width: `${Math.min(100, (elapsed / maxSeconds) * 100)}%` }]} />
                    </View>
                    {audioBridge?.interviewActive ? (
                        <Text style={styles.note}>
                            A gravação da entrevista fica em pausa enquanto você grava esta resposta e volta sozinha.
                        </Text>
                    ) : null}
                    <TouchableOpacity
                        style={styles.stopButton}
                        onPress={() => void stopAndSave()}
                        accessibilityRole="button"
                        accessibilityLabel="Parar gravação"
                    >
                        <Square size={18} color="#fff" fill="#fff" />
                        <Text style={styles.stopText}>Parar gravação</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <>
                    {answer ? (
                        <Playback key={answer.uri} uri={answer.uri} fallbackSeconds={answer.durationSeconds} />
                    ) : null}

                    <TouchableOpacity
                        style={[styles.recordButton, saving && styles.disabled]}
                        onPress={answer ? confirmRerecord : () => void startRecording()}
                        disabled={saving}
                        accessibilityRole="button"
                        accessibilityLabel={answer ? 'Regravar resposta' : 'Gravar resposta'}
                    >
                        {saving ? (
                            <ActivityIndicator size="small" color="#447762" />
                        ) : answer ? (
                            <RotateCcw size={20} color="#447762" />
                        ) : (
                            <Mic size={20} color="#447762" />
                        )}
                        <Text style={styles.recordText}>
                            {saving ? 'Guardando gravação…' : answer ? 'Regravar' : 'Gravar resposta'}
                        </Text>
                    </TouchableOpacity>
                </>
            )}

            {problem?.kind === 'denied' ? (
                <View style={styles.notice}>
                    <Text style={styles.noticeText}>
                        {problem.canAskAgain
                            ? 'Sem a permissão do microfone não dá para gravar. Toque em "Gravar resposta" e permita o acesso quando o aparelho perguntar.'
                            : 'A permissão do microfone está desligada para este aplicativo. Libere o acesso ao microfone nas configurações do aparelho para gravar. As outras questões continuam funcionando.'}
                    </Text>
                    {!problem.canAskAgain ? (
                        <TouchableOpacity style={styles.settingsButton} onPress={openSettings} accessibilityRole="button">
                            <Settings size={16} color="#92400e" />
                            <Text style={styles.settingsText}>Abrir configurações</Text>
                        </TouchableOpacity>
                    ) : null}
                </View>
            ) : null}

            {problem?.kind === 'cut' ? (
                <View style={styles.notice}>
                    <Text style={styles.noticeText}>{problem.message}</Text>
                </View>
            ) : null}
            {problem?.kind === 'error' ? <Text style={styles.errorText}>{problem.message}</Text> : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
    );
}

/** Ouvir a resposta gravada. Separado e com `key` no endereço: ao regravar, nasce um player novo. */
function Playback({ uri, fallbackSeconds }: { uri: string; fallbackSeconds: number }) {
    const player = useAudioPlayer(uri);
    const status = useAudioPlayerStatus(player);

    const total = status.duration > 0 ? status.duration : fallbackSeconds;
    const position = Math.min(status.currentTime, total);

    const toggle = async () => {
        try {
            if (status.playing) {
                player.pause();
                return;
            }
            if (status.didJustFinish || (total > 0 && position >= total - 0.2)) await player.seekTo(0);
            player.play();
        } catch (error) {
            console.log('Falha ao tocar a gravação:', error);
            Alert.alert('Não foi possível ouvir', 'O aparelho não conseguiu tocar a gravação. Tente de novo.');
        }
    };

    return (
        <View style={styles.playerCard}>
            <TouchableOpacity
                style={styles.playButton}
                onPress={() => void toggle()}
                accessibilityRole="button"
                accessibilityLabel={status.playing ? 'Pausar' : 'Ouvir resposta'}
            >
                {status.playing ? <Pause size={22} color="#fff" fill="#fff" /> : <Play size={22} color="#fff" fill="#fff" />}
            </TouchableOpacity>
            <View style={styles.playerInfo}>
                <Text style={styles.playerTitle}>Resposta gravada</Text>
                <View style={styles.track}>
                    <View style={[styles.fill, { width: `${total > 0 ? Math.min(100, (position / total) * 100) : 0}%` }]} />
                </View>
                <Text style={styles.playerTime}>
                    {formatClock(position)} / {formatClock(total)}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    column: { gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    hint: { fontSize: 13, color: '#71717a' },
    errorText: { fontSize: 14, color: '#b91c1c' },
    disabled: { opacity: 0.55 },
    recordButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 56,
        borderWidth: 1,
        borderColor: '#d4d4d8',
        borderRadius: 8,
        backgroundColor: '#fff',
        paddingHorizontal: 16,
    },
    recordText: { fontSize: 16, color: '#18181b' },
    recordingCard: { gap: 12, borderWidth: 1, borderColor: '#b91c1c', borderRadius: 12, backgroundColor: '#fff', padding: 16 },
    dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#b91c1c' },
    timer: { fontSize: 28, fontWeight: 'bold', color: '#18181b' },
    track: { height: 6, backgroundColor: '#e4e4e7', borderRadius: 3, overflow: 'hidden' },
    fill: { height: 6, backgroundColor: '#447762', borderRadius: 3 },
    note: { fontSize: 13, color: '#52525b', lineHeight: 18 },
    stopButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 56,
        borderRadius: 8,
        backgroundColor: '#b91c1c',
    },
    stopText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    playerCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        borderWidth: 1,
        borderColor: '#d4d4d8',
        borderRadius: 12,
        backgroundColor: '#fff',
        padding: 14,
    },
    playButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#447762', alignItems: 'center', justifyContent: 'center' },
    playerInfo: { flex: 1, gap: 6 },
    playerTitle: { fontSize: 14, fontWeight: '600', color: '#18181b' },
    playerTime: { fontSize: 12, color: '#71717a' },
    notice: { backgroundColor: '#fef3c7', borderRadius: 8, padding: 14, gap: 10 },
    noticeText: { color: '#92400e', fontSize: 14, lineHeight: 20 },
    settingsButton: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
    settingsText: { color: '#92400e', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
});

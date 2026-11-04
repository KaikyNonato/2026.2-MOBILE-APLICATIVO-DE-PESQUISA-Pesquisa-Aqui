import { router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, MapPin, Save, Settings } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    AppState,
    BackHandler,
    KeyboardAvoidingView,
    Linking,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AudioBridge } from '@/components/AudioAnswer';
import ConsentModal from '@/components/ConsentModal';
import QuestionInput from '@/components/QuestionInput';
import RecordingStatusBanner from '@/components/RecordingStatusBanner';
import { useInterviewRecording } from '@/hooks/useInterviewRecording';
import {
    CollectionClosedError,
    finishCollection,
    getBlockingMissing,
    getCollection,
    getDurationSeconds,
    saveCollection,
    startCollection,
    type LocalCollection,
} from '@/lib/collectionStore';
import type { InterviewConsent } from '@/lib/collectionUpload';
import {
    getVisibleQuestionIds,
    isAnswerEmpty,
    orderedQuestions,
    pruneHiddenAnswers,
    type AnswerValue,
    type Answers,
    type ResearchPackage,
} from '@/lib/displayRules';
import { deleteAudio, formatClock } from '@/lib/audioStorage';
import { deletePhoto } from '@/lib/photoStorage';
import { getAudioUris, getPhotoUris, isQuestionTypeSupported, validateAnswer } from '@/lib/questionTypes';
import { getCachedResearchPackage } from '@/lib/researchCache';
import { requestAutoSend } from '@/lib/syncQueue';

type Phase = 'loading' | 'consent' | 'starting' | 'blocked' | 'running' | 'finished' | 'error';

// Por que a coleta não começou: a pesquisa grava a entrevista, então sem microfone (ou sem espaço) ela não roda.
type Blocked = { kind: 'mic'; canAskAgain: boolean } | { kind: 'space' };

const SAVE_DELAY_MS = 400;

/** Formata a duração em horas, minutos e segundos. */
function formatDuration(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Volta para a tela anterior ou, se não houver, para a lista de pesquisas. */
function leaveScreen() {
    if (router.canGoBack()) router.back();
    else router.replace('/pesquisas');
}

type RemovedFile = { uri: string; isAudio: boolean };

/** Fotos e áudios que estavam nas respostas de antes e não estão mais nas de depois. */
function findRemovedFiles(pkg: ResearchPackage, before: Answers, after: Answers): RemovedFile[] {
    return orderedQuestions(pkg)
        .filter((q) => q.type === 'PHOTO' || q.type === 'MULTIPLE_PHOTOS' || q.type === 'AUDIO')
        .flatMap((q) => {
            const isAudio = q.type === 'AUDIO';
            const urisOf = isAudio ? getAudioUris : getPhotoUris;
            const kept = new Set(urisOf(after[q.id]));
            return urisOf(before[q.id])
                .filter((uri) => !kept.has(uri))
                .map((uri) => ({ uri, isAudio }));
        });
}

/** Apaga do aparelho os arquivos de áudio e foto removidos. */
function deleteFiles(files: RemovedFile[]) {
    files.forEach(({ uri, isAudio }) => (isAudio ? deleteAudio(uri) : deletePhoto(uri)));
}

/** Quantas respostas preenchidas saíram (fora a da própria questão que o pesquisador mexeu). */
function countDiscarded(before: Answers, after: Answers, exceptQuestionId: number): number {
    return Object.entries(before).filter(
        ([id, value]) =>
            Number(id) !== exceptQuestionId &&
            !isAnswerEmpty(value) &&
            !Object.prototype.hasOwnProperty.call(after, id),
    ).length;
}

/**
 * Tela de coleta: mostra o questionário, valida as respostas, guarda o rascunho e finaliza a
 * coleta.
 */
export default function ColetaScreen() {
    const params = useLocalSearchParams<{ researchId: string; clientId?: string }>();
    const researchId = Number(params.researchId);
    const resumeClientId = params.clientId;

    const [phase, setPhase] = useState<Phase>('loading');
    const [errorMessage, setErrorMessage] = useState('');
    const [pkg, setPkg] = useState<ResearchPackage | null>(null);
    const [collection, setCollection] = useState<LocalCollection | null>(null);
    const [validationMessage, setValidationMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [blocked, setBlocked] = useState<Blocked | null>(null);
    // Gravando a resposta de uma questão de áudio: não dá para avançar, voltar nem sair antes de parar
    const [audioBusy, setAudioBusy] = useState(false);
    // Aviso de que trocar a resposta descartou respostas do ramo abandonado (some ao mudar de questão)
    const [discardNotice, setDiscardNotice] = useState<string | null>(null);

    const recording = useInterviewRecording(pkg);

    // Sempre a versão mais nova da coleta: é ela que vai para o disco, mesmo com o app indo para segundo plano.
    const collectionRef = useRef<LocalCollection | null>(null);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const writeChain = useRef<Promise<void>>(Promise.resolve());
    const initialized = useRef(false);
    const resumedDraft = useRef<LocalCollection | null>(null);
    const consentRef = useRef<InterviewConsent | null>(null);

    // ---------- Gravação no aparelho ----------

    // Devolve true quando tudo o que estava na memória já está gravado no aparelho.
    const flush = useCallback(async (): Promise<boolean> => {
        if (saveTimer.current) {
            clearTimeout(saveTimer.current);
            saveTimer.current = null;
        }
        const snapshot = collectionRef.current;
        if (!snapshot || snapshot.status === 'FINISHED') {
            await writeChain.current;
            return true;
        }

        // Gravações em fila, uma de cada vez, para a mais nova nunca ser sobrescrita por uma antiga.
        let saved = true;
        writeChain.current = writeChain.current
            .then(() => saveCollection(snapshot))
            .catch((error) => {
                if (error instanceof CollectionClosedError) return;
                saved = false;
                console.log('Falha ao salvar rascunho:', error);
            });
        await writeChain.current;
        return saved;
    }, []);

    const updateCollection = useCallback(
        (patch: Partial<LocalCollection>) => {
            if (!collectionRef.current || collectionRef.current.status === 'FINISHED') return;
            const next = { ...collectionRef.current, ...patch };
            collectionRef.current = next;
            setCollection(next);

            if (saveTimer.current) clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
        },
        [flush],
    );

    // Fechar o app, trocar de app ou sair da tela: nada digitado fica para trás.
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            if (state !== 'active') void flush();
        });
        return () => {
            subscription.remove();
            void flush();
        };
    }, [flush]);

    // ---------- Início / retomada ----------

    const begin = useCallback(async () => {
        if (!pkg) return;
        setPhase('starting');
        try {
            // Pesquisa com gravação: libera o microfone antes de a coleta nascer
            const recordingStart = await recording.start();
            if (!recordingStart.ok) {
                if (recordingStart.reason === 'permission-denied') {
                    // Não derruba o app nem expulsa o pesquisador: explica o que fazer e deixa tentar de novo
                    setBlocked({ kind: 'mic', canAskAgain: recordingStart.canAskAgain });
                    setPhase('blocked');
                    return;
                }
                if (recordingStart.reason === 'no-space') {
                    setBlocked({ kind: 'space' });
                    setPhase('blocked');
                    return;
                }
                Alert.alert('Coleta não iniciada', 'É preciso o consentimento do entrevistado para iniciar.');
                leaveScreen();
                return;
            }
            setBlocked(null);

            let current: LocalCollection;
            let staleFiles: RemovedFile[] = [];
            if (resumedDraft.current) {
                current = resumedDraft.current;
                if (consentRef.current) current = { ...current, consent: consentRef.current };
                // Rascunho com resposta de questão que as regras do pacote escondem (ex.: pacote baixado
                // de novo com regras diferentes): sai agora, e os arquivos dela saem do aparelho.
                const kept = pruneHiddenAnswers(pkg, current.answers);
                staleFiles = findRemovedFiles(pkg, current.answers, kept);
                current = { ...current, answers: kept };
            } else {
                // Gera o UUID, grava o início e a localização — sem o pesquisador fazer nada
                current = await startCollection(researchId, consentRef.current ?? undefined);
            }

            const visibleIds = getVisibleQuestionIds(pkg, current.answers);
            const firstVisible = orderedQuestions(pkg).find((q) => visibleIds.has(q.id));
            const stillValid =
                current.currentQuestionId !== null && visibleIds.has(current.currentQuestionId);
            current = {
                ...current,
                currentQuestionId: stillValid ? current.currentQuestionId : (firstVisible?.id ?? null),
            };

            collectionRef.current = current;
            setCollection(current);
            await saveCollection(current);
            deleteFiles(staleFiles); // só depois de gravar o rascunho limpo
            setPhase('running');
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Não foi possível iniciar a coleta.');
            setPhase('error');
        }
    }, [pkg, recording, researchId]);

    // Carrega o pacote e decide: coleta nova, rascunho a retomar ou coleta já finalizada
    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;

        (async () => {
            try {
                const cached = await getCachedResearchPackage(researchId);
                if (!cached) {
                    setErrorMessage('Esta pesquisa ainda não foi baixada neste aparelho.');
                    setPhase('error');
                    return;
                }
                setPkg(cached);

                if (resumeClientId) {
                    const existing = await getCollection(resumeClientId);
                    if (!existing) {
                        setErrorMessage('Rascunho não encontrado no aparelho.');
                        setPhase('error');
                        return;
                    }
                    if (existing.status === 'FINISHED') {
                        collectionRef.current = existing;
                        setCollection(existing);
                        setPhase('finished');
                        return;
                    }
                    resumedDraft.current = existing;
                }
                setPhase(cached.recordInterview ? 'consent' : 'starting');
            } catch {
                setErrorMessage('Não foi possível carregar a pesquisa.');
                setPhase('error');
            }
        })();
    }, [researchId, resumeClientId]);

    // Sem consentimento: começa direto assim que o pacote carrega
    const autoStarted = useRef(false);
    useEffect(() => {
        if (phase === 'starting' && pkg && !pkg.recordInterview && !autoStarted.current) {
            autoStarted.current = true;
            void begin();
        }
    }, [phase, pkg, begin]);

    // Com consentimento: o aceite atualiza o estado do hook, e só então a coleta começa
    const [consentGiven, setConsentGiven] = useState(false);
    const consentStarted = useRef(false);
    useEffect(() => {
        if (consentGiven && recording.consent && !consentStarted.current) {
            consentStarted.current = true;
            void begin();
        }
    }, [consentGiven, recording.consent, begin]);

    // ---------- Questões ----------

    const { visibleQuestions, sectionByQuestion } = useMemo(() => {
        if (!pkg || !collection) return { visibleQuestions: [], sectionByQuestion: new Map<number, string>() };
        const visibleIds = getVisibleQuestionIds(pkg, collection.answers);
        const sections = new Map<number, string>();
        for (const section of pkg.sections) {
            for (const question of section.questions) sections.set(question.id, section.title);
        }
        return {
            visibleQuestions: orderedQuestions(pkg).filter((q) => visibleIds.has(q.id)),
            sectionByQuestion: sections,
        };
    }, [pkg, collection]);

    const rawIndex = visibleQuestions.findIndex((q) => q.id === collection?.currentQuestionId);
    const currentIndex = rawIndex >= 0 ? rawIndex : 0;
    const currentQuestion = visibleQuestions[currentIndex];
    const isLast = currentIndex === visibleQuestions.length - 1;

    // Grava no banco local a resposta da questão que está sendo deixada e só então mostra a próxima.
    // Se a gravação falhar, o pesquisador continua onde está (nada se perde) e é avisado.
    const saveBeforeLeaving = async (): Promise<boolean> => {
        const saved = await flush();
        if (!saved) {
            Alert.alert(
                'Resposta não gravada',
                'Não foi possível gravar a resposta no aparelho. Tente avançar novamente.',
            );
        }
        return saved;
    };

    const goToQuestion = async (questionId: number, message: string | null = null) => {
        if (!(await saveBeforeLeaving())) return;
        setValidationMessage(message);
        setDiscardNotice(null);
        updateCollection({ currentQuestionId: questionId });
        void flush(); // grava também o ponto em que o pesquisador parou
    };

    const handleChange = (value: AnswerValue) => {
        if (!pkg || !currentQuestion) return;
        // Parte sempre da coleta mais nova (a da memória), não de uma tela que pode ter ficado para trás
        const base = collectionRef.current ?? collection;
        if (!base) return;

        setValidationMessage(null);
        // Se a mudança esconde questões que dependiam desta, as respostas delas saem também:
        // trocar de "sim" para "não" não deixa o ramo abandonado seguir escondido para o servidor.
        const answers = pruneHiddenAnswers(pkg, { ...base.answers, [currentQuestion.id]: value });

        const discarded = countDiscarded(base.answers, answers, currentQuestion.id);
        setDiscardNotice(
            discarded > 0
                ? `Esta mudança descartou ${discarded} ${discarded === 1 ? 'resposta que dependia' : 'respostas que dependiam'} da resposta anterior.`
                : null,
        );

        updateCollection({ answers });
        discardRemovedPhotos(base.answers, answers);
    };

    // Foto ou áudio removido (ou trocado/regravado, ou de questão que ficou escondida) não pode ficar
    // ocupando espaço no aparelho. Só apaga o arquivo depois de gravar a resposta nova, para um
    // rascunho nunca apontar para arquivo que sumiu.
    const discardRemovedPhotos = (before: Answers, after: Answers) => {
        if (!pkg) return;
        const removed = findRemovedFiles(pkg, before, after);
        if (removed.length === 0) return;
        void flush().then((saved) => {
            if (saved) deleteFiles(removed);
        });
    };

    const warnRecordingInProgress = () => {
        Alert.alert('Gravação em andamento', 'Pare a gravação da resposta antes de continuar.');
    };

    const handleBack = () => {
        if (audioBusy) return warnRecordingInProgress();
        if (currentIndex > 0) void goToQuestion(visibleQuestions[currentIndex - 1].id);
    };

    const handleNext = async () => {
        if (!collection || !currentQuestion) return;
        if (audioBusy) return warnRecordingInProgress();
        const answer = collection.answers[currentQuestion.id];

        if (
            currentQuestion.isRequired &&
            isQuestionTypeSupported(currentQuestion.type) &&
            isAnswerEmpty(answer)
        ) {
            setValidationMessage(
                `Questão ${currentIndex + 1} é obrigatória: "${currentQuestion.statement}". Responda para continuar.`,
            );
            return;
        }

        // Formato e limites vêm do pacote (tamanho do texto, mínimo/máximo, intervalo de datas)
        const formatError = validateAnswer(currentQuestion, answer);
        if (formatError) {
            setValidationMessage(`Questão ${currentIndex + 1}: ${formatError}`);
            return;
        }

        if (isLast) {
            if (await saveBeforeLeaving()) confirmFinish();
        } else {
            await goToQuestion(visibleQuestions[currentIndex + 1].id);
        }
    };

    // ---------- Finalizar / sair ----------

    const confirmFinish = () => {
        if (!collection) return;

        // Revisão final: nenhuma obrigatória visível pode ter ficado em branco
        const missing = getBlockingMissing(visibleQuestions, collection.answers, isAnswerEmpty);
        if (missing.length > 0) {
            const first = missing[0];
            const position = visibleQuestions.findIndex((q) => q.id === first.id) + 1;
            void goToQuestion(
                first.id,
                `Questão ${position} é obrigatória: "${first.statement}". Responda para finalizar.`,
            );
            return;
        }

        // Quem voltou e deixou uma resposta fora do formato/limite não consegue finalizar com ela
        const invalid = visibleQuestions
            .map((q, i) => ({ question: q, position: i + 1, error: validateAnswer(q, collection.answers[q.id]) }))
            .find((item) => item.error);
        if (invalid) {
            void goToQuestion(invalid.question.id, `Questão ${invalid.position}: ${invalid.error}`);
            return;
        }

        const gapWarning =
            recording.interruptions.length > 0
                ? '\n\nAtenção: a gravação da entrevista foi interrompida e o áudio ficará incompleto.'
                : '';
        Alert.alert(
            'Finalizar coleta',
            `Depois de finalizada, a coleta não poderá mais ser editada. Deseja finalizar?${gapWarning}`,
            [
                { text: 'Revisar', style: 'cancel' },
                { text: 'Finalizar', onPress: () => void finish() },
            ],
        );
    };

    const finish = async () => {
        if (!collectionRef.current || !pkg) return;
        setBusy(true);
        try {
            // Última garantia: a coleta não fecha carregando resposta de questão escondida
            const current = collectionRef.current;
            const kept = pruneHiddenAnswers(pkg, current.answers);
            if (Object.keys(kept).length !== Object.keys(current.answers).length) {
                updateCollection({ answers: kept });
                discardRemovedPhotos(current.answers, kept);
            }
            await flush();
            const extra = await recording.finish(); // para a gravação e devolve aceite + áudio
            const finished = await finishCollection(collectionRef.current, extra); // grava o término e fecha
            collectionRef.current = finished;
            setCollection(finished);
            setPhase('finished');
            // A coleta finalizada já está na fila de envio; com rede, o envio começa em segundo plano
            // e o pesquisador segue livre para iniciar a próxima coleta.
            void requestAutoSend();
        } catch (error) {
            Alert.alert('Erro ao finalizar', error instanceof Error ? error.message : 'Tente novamente.');
        } finally {
            setBusy(false);
        }
    };

    const saveDraftAndLeave = useCallback(async () => {
        setBusy(true);
        await flush();
        await recording.reset();
        setBusy(false);
        leaveScreen();
    }, [flush, recording]);

    const askLeave = useCallback(() => {
        if (audioBusy) {
            Alert.alert('Gravação em andamento', 'Pare a gravação da resposta antes de sair.');
            return;
        }
        Alert.alert('Sair da coleta', 'As respostas já dadas ficam salvas como rascunho para você retomar depois.', [
            { text: 'Continuar coletando', style: 'cancel' },
            { text: 'Salvar rascunho e sair', onPress: () => void saveDraftAndLeave() },
        ]);
    }, [saveDraftAndLeave, audioBusy]);

    // Botão voltar do Android também protege a entrevista em andamento
    useEffect(() => {
        if (phase !== 'running') return;
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            askLeave();
            return true;
        });
        return () => subscription.remove();
    }, [phase, askLeave]);

    // ---------- Telas ----------

    if (phase === 'loading' || phase === 'starting') {
        return (
            <SafeAreaView style={styles.center}>
                <ActivityIndicator size="large" color="#447762" />
                <Text style={styles.centerText}>
                    {phase === 'starting' ? 'Registrando início e localização da coleta…' : 'Carregando pesquisa…'}
                </Text>
            </SafeAreaView>
        );
    }

    if (phase === 'consent') {
        return (
            <SafeAreaView style={styles.center}>
                <ConsentModal
                    visible
                    researchTitle={pkg?.title}
                    onConfirm={() => {
                        consentRef.current = recording.confirmConsent();
                        setPhase('starting');
                        setConsentGiven(true);
                    }}
                    onCancel={leaveScreen}
                />
            </SafeAreaView>
        );
    }

    if (phase === 'blocked' && blocked) {
        const mic = blocked.kind === 'mic';
        return (
            <SafeAreaView style={styles.center}>
                <AlertTriangle size={48} color="#92400e" />
                <Text style={styles.errorTitle}>
                    {mic ? 'Microfone bloqueado' : 'Sem espaço para gravar'}
                </Text>
                <Text style={styles.centerText}>
                    {!mic
                        ? 'Esta pesquisa grava a entrevista e o aparelho está sem espaço livre suficiente. Apague fotos, vídeos ou apps que não usa e tente de novo.'
                        : blocked.canAskAgain
                            ? 'Esta pesquisa grava a entrevista e precisa do microfone. Toque em "Tentar novamente" e permita o acesso quando o aparelho perguntar. A coleta só começa com a gravação liberada.'
                            : 'Esta pesquisa grava a entrevista e o acesso ao microfone está desligado para o aplicativo. Abra as configurações, ative o microfone, volte ao app e toque em "Tentar novamente".'}
                </Text>
                {mic && !blocked.canAskAgain ? (
                    <TouchableOpacity
                        style={[styles.secondaryButton, styles.fixedWidth]}
                        onPress={() => Linking.openSettings().catch(() => undefined)}
                    >
                        <Settings size={18} color="#447762" />
                        <Text style={styles.secondaryButtonText}>Abrir configurações</Text>
                    </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={[styles.primaryButton, styles.fixedWidth]} onPress={() => void begin()}>
                    <Text style={styles.primaryButtonText}>Tentar novamente</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.secondaryButton, styles.fixedWidth]} onPress={leaveScreen}>
                    <Text style={styles.secondaryButtonText}>Voltar às pesquisas</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    if (phase === 'error') {
        return (
            <SafeAreaView style={styles.center}>
                <Text style={styles.errorTitle}>Não foi possível abrir a coleta</Text>
                <Text style={styles.centerText}>{errorMessage}</Text>
                <TouchableOpacity style={[styles.primaryButton, styles.fixedWidth]} onPress={leaveScreen}>
                    <Text style={styles.primaryButtonText}>Voltar</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    if (phase === 'finished' && collection) {
        const duration = getDurationSeconds(collection);
        return (
            <SafeAreaView style={styles.center}>
                <CheckCircle2 size={64} color="#447762" />
                <Text style={styles.finishedTitle}>Coleta finalizada</Text>
                <View style={styles.summary}>
                    <Text style={styles.summaryLine}>
                        Início: {new Date(collection.startedAt).toLocaleString('pt-BR')}
                    </Text>
                    <Text style={styles.summaryLine}>
                        Término: {collection.finishedAt ? new Date(collection.finishedAt).toLocaleString('pt-BR') : '—'}
                    </Text>
                    {duration !== null && <Text style={styles.summaryLine}>Duração: {formatDuration(duration)}</Text>}
                    <Text style={styles.summaryLine}>
                        Localização de início: {collection.locationStatus === 'OK' ? 'registrada' : 'não registrada'}
                    </Text>
                </View>
                {pkg?.recordInterview ? (
                    <View
                        style={[
                            styles.summary,
                            (!collection.audio || collection.audio.hasGaps) && styles.summaryWarning,
                        ]}
                    >
                        <Text style={styles.summaryLine}>
                            {!collection.audio
                                ? 'Gravação da entrevista: NÃO foi gravada. A coleta segue sem áudio.'
                                : collection.audio.hasGaps
                                    ? `Gravação da entrevista: incompleta (${formatClock(collection.audio.durationSeconds)} gravados, com interrupções).`
                                    : `Gravação da entrevista: salva (${formatClock(collection.audio.durationSeconds)}).`}
                        </Text>
                    </View>
                ) : null}
                <Text style={styles.centerText}>
                    A coleta está salva no aparelho, fechada para edição, e entrou na fila de envio. Com internet, ela é
                    enviada sozinha; você acompanha na aba Sinc.
                </Text>
                <TouchableOpacity style={[styles.primaryButton, styles.fixedWidth]} onPress={leaveScreen}>
                    <Text style={styles.primaryButtonText}>Voltar às pesquisas</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    if (!pkg || !collection) return null;

    if (!currentQuestion) {
        return (
            <SafeAreaView style={styles.center}>
                <Text style={styles.errorTitle}>Pesquisa sem questões</Text>
                <Text style={styles.centerText}>O servidor não enviou questões para esta pesquisa.</Text>
                <TouchableOpacity style={[styles.primaryButton, styles.fixedWidth]} onPress={leaveScreen}>
                    <Text style={styles.primaryButtonText}>Voltar</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    const audioBridge: AudioBridge = {
        onBusyChange: setAudioBusy,
        pauseInterview: recording.pauseForAnswer,
        resumeInterview: recording.resumeAfterAnswer,
        interviewActive: recording.isRecording,
    };

    const total = visibleQuestions.length;
    const progress = (currentIndex + 1) / total;
    const answer = collection.answers[currentQuestion.id];
    const sectionTitle = sectionByQuestion.get(currentQuestion.id);

    return (
        <SafeAreaView style={styles.container}>
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <View style={styles.header}>
                    <View style={styles.headerTop}>
                        <Text style={styles.headerTitle} numberOfLines={1}>
                            {pkg.title}
                        </Text>
                        <TouchableOpacity style={styles.draftButton} onPress={askLeave} disabled={busy}>
                            <Save size={16} color="#447762" />
                            <Text style={styles.draftButtonText}>Salvar e sair</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.progressRow}>
                        <Text style={styles.progressText}>
                            Questão {currentIndex + 1} de {total}
                        </Text>
                        <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
                    </View>
                    <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                    </View>

                    <View style={styles.locationRow}>
                        <MapPin size={12} color={collection.locationStatus === 'OK' ? '#447762' : '#92400e'} />
                        <Text
                            style={[styles.locationText, collection.locationStatus !== 'OK' && styles.locationWarning]}
                        >
                            {collection.locationStatus === 'OK'
                                ? 'Localização de início registrada'
                                : collection.locationStatus === 'DENIED'
                                    ? 'Localização não registrada: permissão negada'
                                    : 'Localização não registrada: GPS indisponível'}
                        </Text>
                    </View>
                </View>

                <RecordingStatusBanner
                    isRecording={recording.isRecording}
                    seconds={recording.elapsedSeconds}
                    pausedForAnswer={recording.pausedForAnswer}
                    interrupted={recording.interruption}
                    lowSpace={recording.lowSpace}
                    foregroundOnly={recording.isRecording && !recording.backgroundEnabled}
                    onResume={() => void recording.resume()}
                />

                <ScrollView
                    style={styles.flex}
                    contentContainerStyle={styles.body}
                    keyboardShouldPersistTaps="handled"
                >
                    {sectionTitle ? <Text style={styles.sectionTitle}>{sectionTitle}</Text> : null}
                    <Text style={styles.statement}>
                        {currentQuestion.statement}
                        {currentQuestion.isRequired ? <Text style={styles.required}> *</Text> : null}
                    </Text>

                    <QuestionInput
                        key={currentQuestion.id}
                        question={currentQuestion}
                        value={answer}
                        onChange={handleChange}
                        collectionId={collection.clientId}
                        audioBridge={audioBridge}
                    />

                    {validationMessage ? (
                        <View style={styles.validationBox}>
                            <Text style={styles.validationText}>{validationMessage}</Text>
                        </View>
                    ) : null}

                    {discardNotice ? (
                        <View style={styles.noticeBox}>
                            <Text style={styles.noticeText}>{discardNotice}</Text>
                        </View>
                    ) : null}
                </ScrollView>

                <View style={styles.footer}>
                    <TouchableOpacity
                        style={[styles.secondaryButton, (currentIndex === 0 || audioBusy) && styles.buttonDisabled]}
                        onPress={handleBack}
                        disabled={currentIndex === 0 || busy || audioBusy}
                    >
                        <ChevronLeft size={20} color={currentIndex === 0 ? '#a1a1aa' : '#447762'} />
                        <Text style={[styles.secondaryButtonText, currentIndex === 0 && styles.textDisabled]}>Voltar</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.primaryButton, styles.flex]} onPress={handleNext} disabled={busy || audioBusy}>
                        {busy ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <>
                                <Text style={styles.primaryButtonText}>{isLast ? 'Finalizar' : 'Avançar'}</Text>
                                {!isLast && <ChevronRight size={20} color="#fff" />}
                            </>
                        )}
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, backgroundColor: '#fafafa' },
    center: { flex: 1, backgroundColor: '#fafafa', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
    centerText: { fontSize: 14, color: '#71717a', textAlign: 'center' },
    errorTitle: { fontSize: 18, fontWeight: 'bold', color: '#18181b', textAlign: 'center' },
    finishedTitle: { fontSize: 22, fontWeight: 'bold', color: '#18181b' },
    summary: { gap: 4, alignSelf: 'stretch', backgroundColor: '#fff', borderRadius: 8, padding: 16, borderWidth: 1, borderColor: '#00000015' },
    summaryWarning: { backgroundColor: '#fef3c7', borderColor: '#92400e' },
    summaryLine: { fontSize: 14, color: '#3f3f46' },
    fixedWidth: { alignSelf: 'stretch', flex: 0 },

    header: { padding: 16, paddingBottom: 12, gap: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#00000010' },
    headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    headerTitle: { flex: 1, fontSize: 16, fontWeight: 'bold', color: '#18181b' },
    draftButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#447762' },
    draftButtonText: { fontSize: 13, color: '#447762', fontWeight: '600' },
    progressRow: { flexDirection: 'row', justifyContent: 'space-between' },
    progressText: { fontSize: 13, color: '#52525b', fontWeight: '600' },
    progressTrack: { height: 6, backgroundColor: '#e4e4e7', borderRadius: 3, overflow: 'hidden' },
    progressFill: { height: 6, backgroundColor: '#447762', borderRadius: 3 },
    locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    locationText: { fontSize: 12, color: '#447762' },
    locationWarning: { color: '#92400e' },

    body: { padding: 20, gap: 16 },
    sectionTitle: { fontSize: 13, color: '#B66D56', fontWeight: '600', textTransform: 'uppercase' },
    statement: { fontSize: 20, fontWeight: 'bold', color: '#18181b', lineHeight: 28 },
    required: { color: '#b91c1c' },
    validationBox: { backgroundColor: '#fee2e2', borderRadius: 8, padding: 12 },
    validationText: { color: '#b91c1c', fontSize: 14, fontWeight: '600' },
    noticeBox: { backgroundColor: '#fef3c7', borderRadius: 8, padding: 12 },
    noticeText: { color: '#92400e', fontSize: 14 },

    footer: { flexDirection: 'row', gap: 12, padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#00000010' },
    primaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#447762', padding: 14, borderRadius: 8 },
    primaryButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
    secondaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: '#447762' },
    secondaryButtonText: { color: '#447762', fontWeight: 'bold', fontSize: 16 },
    buttonDisabled: { borderColor: '#d4d4d8' },
    textDisabled: { color: '#a1a1aa' },
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import type {
    CollectionAudio,
    CollectionInput,
    CollectionPhoto,
    CollectionQuestionAudio,
    InterviewConsent,
    RecordingIssue,
} from './collectionUpload';
import { getDeviceId } from './researchCache';
import { getVisibleQuestionIdsInOrder } from './displayRules';
import type { AnswerValue, Answers, DisplayRule, PackageQuestion } from './displayRules';
import {
    getPhotoUris,
    isQuestionTypeSupported,
    parseAudioAnswer,
    parseLocationAnswer,
    serializeLocationAnswer,
} from './questionTypes';

// Coletas guardadas no aparelho (AsyncStorage): tudo aqui funciona sem internet.
// Uma chave por coleta, para que gravar uma resposta nunca reescreva as outras coletas.
const COLLECTION_PREFIX = 'collection_';

export type CollectionStatus = 'IN_PROGRESS' | 'FINISHED';

// OK: capturada | DENIED: pesquisador negou a permissão | UNAVAILABLE: GPS sem sinal/desligado
export type LocationStatus = 'OK' | 'DENIED' | 'UNAVAILABLE';

export interface StartLocation {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    capturedAt: string; // ISO 8601
}

// Motivo de um envio que o servidor não confirmou.
export interface SendFailure {
    reason: string; // texto para o pesquisador ler
    code?: string; // código do servidor (RESEARCH_CLOSED, CONSENT_REQUIRED...), quando houver
    retryable: boolean; // false = recusa definitiva: o envio automático não insiste, só "tentar de novo" reenvia
    at: string; // ISO 8601
}

// Histórico de envio da coleta finalizada. Some junto com a coleta quando o servidor confirma.
export interface SendState {
    attempts: number; // tentativas que falharam
    lastFailure?: SendFailure;
}

// Andamento do envio em duas etapas: as respostas primeiro, depois cada arquivo.
// Também some junto com a coleta quando tudo foi confirmado.
export interface UploadState {
    collectionSent: boolean; // o servidor já tem as respostas desta coleta
    uploaded: string[]; // chaves dos arquivos que o servidor já recebeu (não sobem de novo)
}

export interface LocalCollection {
    // UUID gerado no aparelho: é ele que impede a duplicidade quando a coleta for enviada
    clientId: string;
    researchId: number;
    status: CollectionStatus;
    startedAt: string; // ISO 8601, gravado sozinho ao iniciar
    startLocation: StartLocation | null; // gravada sozinha ao iniciar; o app não tem tela para editá-la
    locationStatus: LocationStatus;
    finishedAt?: string; // ISO 8601, só existe depois de finalizar
    answers: Answers;
    currentQuestionId: number | null; // onde o pesquisador parou, para retomar do mesmo ponto
    consent?: InterviewConsent;
    audio?: CollectionAudio;
    // Interrupções da gravação da entrevista: ficam registradas mesmo se não houver arquivo de áudio
    recordingIssues?: RecordingIssue[];
    // Só existe depois de uma tentativa de envio que falhou
    sendState?: SendState;
    upload?: UploadState;
    updatedAt: string;
}

/** Erro ao tentar editar uma coleta que já foi finalizada. */
export class CollectionClosedError extends Error {
    constructor() {
        super('Esta coleta já foi finalizada e não pode mais ser editada.');
    }
}

/** Chave da coleta no armazenamento local. */
const keyOf = (clientId: string) => `${COLLECTION_PREFIX}${clientId}`;

// ---------- Localização de início ----------

const LOCATION_TIMEOUT_MS = 12000;

/** Espera a promessa por até `ms` milissegundos. Passado o prazo, devolve `null`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        promise
            .then((value) => resolve(value))
            .catch(() => resolve(null))
            .finally(() => clearTimeout(timer));
    });
}

/**
 * Lê o GPS do aparelho (não precisa de internet, funciona em modo avião).
 * Nunca lança erro: se não der, devolve o motivo e a coleta segue mesmo assim.
 */
export async function captureStartLocation(): Promise<{ status: LocationStatus; location: StartLocation | null }> {
    try {
        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted && permission.canAskAgain) {
            permission = await Location.requestForegroundPermissionsAsync();
        }
        if (!permission.granted) return { status: 'DENIED', location: null };

        const position =
            (await withTimeout(
                Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
                LOCATION_TIMEOUT_MS,
            )) ?? (await Location.getLastKnownPositionAsync().catch(() => null));

        if (!position) return { status: 'UNAVAILABLE', location: null };

        return {
            status: 'OK',
            location: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy ?? null,
                capturedAt: new Date(position.timestamp).toISOString(),
            },
        };
    } catch {
        return { status: 'UNAVAILABLE', location: null };
    }
}

// ---------- Leitura e gravação ----------

/** Lê uma coleta do armazenamento local (`null` se não existir). */
async function readCollection(clientId: string): Promise<LocalCollection | null> {
    const json = await AsyncStorage.getItem(keyOf(clientId));
    return json ? (JSON.parse(json) as LocalCollection) : null;
}

/**
 * Grava a coleta no aparelho. Depois de finalizada ela fica fechada: qualquer gravação
 * que tente reabri-la ou alterá-la é recusada.
 */
export async function saveCollection(collection: LocalCollection): Promise<void> {
    const stored = await readCollection(collection.clientId);
    if (stored?.status === 'FINISHED') throw new CollectionClosedError();

    const next: LocalCollection = { ...collection, updatedAt: new Date().toISOString() };
    await AsyncStorage.setItem(keyOf(collection.clientId), JSON.stringify(next));
}

/** Busca uma coleta pelo id local. */
export async function getCollection(clientId: string): Promise<LocalCollection | null> {
    return readCollection(clientId);
}

/** Lista as coletas guardadas no aparelho, opcionalmente só as de uma pesquisa. */
export async function listCollections(researchId?: number): Promise<LocalCollection[]> {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(COLLECTION_PREFIX));
    if (keys.length === 0) return [];

    const entries = await AsyncStorage.multiGet(keys);
    return entries
        .map(([, json]) => (json ? (JSON.parse(json) as LocalCollection) : null))
        .filter((c): c is LocalCollection => c !== null && (researchId === undefined || c.researchId === researchId))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Rascunhos (coletas começadas e não finalizadas) de uma pesquisa, o mais recente primeiro. */
export async function listDrafts(researchId: number): Promise<LocalCollection[]> {
    return (await listCollections(researchId)).filter((c) => c.status === 'IN_PROGRESS');
}

// ---------- Fila de envio ----------

/**
 * A fila de envio são as coletas finalizadas que o servidor ainda não confirmou, a mais antiga primeiro.
 * Finalizar a coleta já a coloca aqui; confirmar no servidor a tira (removeCollection).
 */
export async function listSendQueue(): Promise<LocalCollection[]> {
    const finished = (await listCollections()).filter((c) => c.status === 'FINISHED');
    return finished.sort((a, b) => (a.finishedAt ?? a.startedAt).localeCompare(b.finishedAt ?? b.startedAt));
}

/**
 * Guarda por que o envio falhou. A coleta continua finalizada e fechada: só o histórico de envio muda
 * (por isso não passa por saveCollection, que recusa gravar coleta finalizada).
 */
export async function recordSendFailure(clientId: string, failure: SendFailure): Promise<void> {
    const stored = await readCollection(clientId);
    if (!stored || stored.status !== 'FINISHED') return;

    const next: LocalCollection = {
        ...stored,
        sendState: { attempts: (stored.sendState?.attempts ?? 0) + 1, lastFailure: failure },
    };
    await AsyncStorage.setItem(keyOf(clientId), JSON.stringify(next));
}

/** Altera uma coleta já finalizada. Ignora se não existir ou se ainda for rascunho. */
async function patchFinished(clientId: string, patch: (stored: LocalCollection) => LocalCollection): Promise<void> {
    const stored = await readCollection(clientId);
    if (!stored || stored.status !== 'FINISHED') return;
    await AsyncStorage.setItem(keyOf(clientId), JSON.stringify(patch(stored)));
}

/** O servidor recebeu as respostas: daqui em diante só os arquivos que faltam são reenviados. */
export async function markCollectionSent(clientId: string): Promise<void> {
    await patchFinished(clientId, (stored) => ({
        ...stored,
        upload: { uploaded: stored.upload?.uploaded ?? [], collectionSent: true },
        // a falha anterior (se houve) era das respostas, que agora chegaram
        sendState: undefined,
    }));
}

/** O servidor disse que não tem a coleta (ex.: base restaurada): as respostas voltam a ser enviadas. */
export async function resetCollectionSent(clientId: string): Promise<void> {
    await patchFinished(clientId, (stored) => ({
        ...stored,
        upload: { uploaded: stored.upload?.uploaded ?? [], collectionSent: false },
    }));
}

/** Guarda que um arquivo já chegou ao servidor. */
export async function markFileUploaded(clientId: string, key: string): Promise<void> {
    await patchFinished(clientId, (stored) => {
        const uploaded = stored.upload?.uploaded ?? [];
        return {
            ...stored,
            upload: {
                collectionSent: stored.upload?.collectionSent ?? true,
                uploaded: uploaded.includes(key) ? uploaded : [...uploaded, key],
            },
        };
    });
}

/** Tira a coleta do aparelho. Só o envio chama isto, depois de o servidor confirmar o recebimento. */
export async function removeCollection(clientId: string): Promise<void> {
    await AsyncStorage.removeItem(keyOf(clientId));
}

// ---------- Ciclo de vida da coleta ----------

/**
 * Inicia uma coleta: gera o UUID no aparelho, grava o horário de início e a localização.
 * O horário é o do toque em "iniciar"; a localização vem em seguida, sem o pesquisador fazer nada.
 */
export async function startCollection(researchId: number, consent?: InterviewConsent): Promise<LocalCollection> {
    const startedAt = new Date().toISOString();

    const collection: LocalCollection = {
        clientId: Crypto.randomUUID(),
        researchId,
        status: 'IN_PROGRESS',
        startedAt,
        startLocation: null,
        locationStatus: 'UNAVAILABLE',
        answers: {},
        currentQuestionId: null,
        consent,
        updatedAt: startedAt,
    };

    // Grava já com o horário: se o app fechar enquanto o GPS responde, o início não se perde.
    await saveCollection(collection);

    const { status, location } = await captureStartLocation();
    const withLocation: LocalCollection = { ...collection, startLocation: location, locationStatus: status };
    await saveCollection(withLocation);
    return withLocation;
}

/** Finaliza: grava o horário de término e fecha a coleta para edição. */
export async function finishCollection(
    collection: LocalCollection,
    extra: { consent?: InterviewConsent; audio?: CollectionAudio; recordingIssues?: RecordingIssue[] } = {},
): Promise<LocalCollection> {
    const finished: LocalCollection = {
        ...collection,
        ...extra,
        consent: extra.consent ?? collection.consent,
        status: 'FINISHED',
        finishedAt: new Date().toISOString(),
    };
    await saveCollection(finished);
    return finished;
}

/** Duração da coleta em segundos (`null` se ainda não terminou). */
export function getDurationSeconds(collection: Pick<LocalCollection, 'startedAt' | 'finishedAt'>): number | null {
    if (!collection.finishedAt) return null;
    const ms = new Date(collection.finishedAt).getTime() - new Date(collection.startedAt).getTime();
    return Math.max(0, Math.round(ms / 1000));
}

// ---------- Respostas ----------

/** Obrigatórias visíveis e ainda em branco, ignorando os tipos que o app ainda não preenche. */
export function getBlockingMissing(
    visibleQuestions: PackageQuestion[],
    answers: Answers,
    isAnswerEmpty: (answer: AnswerValue) => boolean,
): PackageQuestion[] {
    return visibleQuestions.filter(
        (q) => q.isRequired && isQuestionTypeSupported(q.type) && isAnswerEmpty(answers[q.id]),
    );
}

/** Diz se a questão é de áudio. */
const isAudioQuestion = (question: PackageQuestion) => question.type === 'AUDIO';

/** Diz se a questão é de foto (uma ou várias). */
const isPhotoQuestion = (question: PackageQuestion) => question.type === 'PHOTO' || question.type === 'MULTIPLE_PHOTOS';

/** Nome do arquivo de uma foto guardada no aparelho (último trecho do endereço). */
const photoFileName = (uri: string) => uri.split('/').pop() ?? uri;

/**
 * Converte a resposta no texto enviado ao servidor (`null` se vazia). Em foto, leva o nome do
 * arquivo em vez do endereço local.
 */
function serializeAnswer(question: PackageQuestion, answer: AnswerValue): string | null {
    if (answer === null || answer === undefined) return null;

    // Foto: o endereço local não serve ao servidor. A resposta leva o nome do arquivo (uma foto) ou a
    // lista de nomes (várias), e os arquivos seguem junto, no mesmo envio.
    if (isPhotoQuestion(question)) {
        const names = getPhotoUris(answer).map(photoFileName);
        if (names.length === 0) return null;
        return question.type === 'PHOTO' ? names[0] : JSON.stringify(names);
    }

    // Áudio: como na foto, a resposta leva o nome do arquivo e o arquivo segue junto, no mesmo envio.
    if (isAudioQuestion(question)) {
        const audio = parseAudioAnswer(answer);
        return audio ? photoFileName(audio.uri) : null;
    }

    // Localização: latitude, longitude, precisão e a marcação de baixa precisão vão no valor da resposta,
    // para o administrador ver depois quais pontos merecem conferência.
    if (question.type === 'LOCATION') {
        const location = parseLocationAnswer(answer);
        return location ? serializeLocationAnswer(location) : null;
    }

    if (question.type === 'YES_NO') return answer === true ? 'YES' : answer === false ? 'NO' : String(answer);
    // Número sempre com ponto decimal, mesmo que o pesquisador tenha digitado vírgula
    if (question.type === 'NUMERIC' && typeof answer === 'string') return answer.trim().replace(',', '.');
    if (question.type === 'DATE' && typeof answer === 'string') {
        const m = answer.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : answer;
    }
    if (Array.isArray(answer)) return JSON.stringify(answer);
    return String(answer);
}

/**
 * Monta o que o envio (collectionUpload) espera, a partir de uma coleta finalizada.
 *
 * `allQuestions` vem na ordem do questionário (orderedQuestions do pacote) e `displayRules` são as
 * regras de pulo do mesmo pacote. Questão escondida por elas não viaja: nem a resposta, nem a foto,
 * nem o áudio. Sem `displayRules`, todas as questões contam como visíveis.
 */
export async function buildCollectionInput(
    collection: LocalCollection,
    allQuestions: PackageQuestion[],
    displayRules: DisplayRule[] = [],
): Promise<CollectionInput> {
    if (collection.status !== 'FINISHED' || !collection.finishedAt) {
        throw new Error('Só coletas finalizadas podem ser enviadas.');
    }

    const visibleIds = getVisibleQuestionIdsInOrder(allQuestions, displayRules, collection.answers);
    const questions = allQuestions.filter((question) => visibleIds.has(question.id));

    const answers = questions.flatMap((question) => {
        const value = serializeAnswer(question, collection.answers[question.id]);
        return value === null || value === '' ? [] : [{ questionId: question.id, value }];
    });

    // Fotos guardadas no aparelho entram na mesma fila de envio da coleta
    const photos: CollectionPhoto[] = questions.filter(isPhotoQuestion).flatMap((question) =>
        getPhotoUris(collection.answers[question.id]).map((uri) => ({
            questionId: question.id,
            uri,
            name: photoFileName(uri),
            mimeType: 'image/jpeg',
        })),
    );

    // Áudios das questões guardados no aparelho entram na mesma fila de envio da coleta
    const questionAudios: CollectionQuestionAudio[] = questions.filter(isAudioQuestion).flatMap((question) => {
        const audio = parseAudioAnswer(collection.answers[question.id]);
        return audio
            ? [
                {
                    questionId: question.id,
                    uri: audio.uri,
                    name: photoFileName(audio.uri),
                    mimeType: 'audio/mp4',
                    durationSeconds: audio.durationSeconds,
                },
            ]
            : [];
    });

    return {
        researchId: collection.researchId,
        clientId: collection.clientId,
        deviceId: await getDeviceId(),
        startedAt: collection.startedAt,
        finishedAt: collection.finishedAt,
        answers,
        startLocation: collection.startLocation
            ? {
                latitude: collection.startLocation.latitude,
                longitude: collection.startLocation.longitude,
                accuracy: collection.startLocation.accuracy,
            }
            : null,
        consent: collection.consent,
        audio: collection.audio,
        recordingIssues: collection.recordingIssues,
        photos,
        questionAudios,
    };
}

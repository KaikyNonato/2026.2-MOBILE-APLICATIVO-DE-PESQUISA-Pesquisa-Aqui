import { apiFetch } from "./apiFetcher";
import { asPage, pageQuery, type Page, type PageParams } from "./pagination";

export interface CollectionSummary {
    id: number;
    researchId: number;
    researcherId: number;
    researcherName: string | null;
    researcherAvatarUrl?: string | null;
    startedAt: string;
    finishedAt: string;
    receivedAt: string;
    consent: {
        given: boolean;
        at: string | null;
        confirmedById: number | null;
        confirmedByName: string | null;
    };
    hasAudio: boolean;
    audioDurationSeconds: number | null;
    audioSizeBytes: number | null;
}

export interface CollectionQuestionOption {
    id: number;
    text: string;
}

// Foto ou áudio de uma resposta guardado no servidor.
export interface CollectionMediaFile {
    name: string;
    mimeType: string;
}

// Arquivo que a resposta cita (foto ou áudio) e se já chegou ao servidor.
export interface CollectionExpectedFile {
    // Nome no aparelho, como a resposta o guarda
    name: string;
    received: boolean;
    // Presente quando received = true: o arquivo guardado, para abrir pela API autenticada
    file: CollectionMediaFile | null;
}

export interface CollectionQuestion {
    id: number;
    statement: string;
    type: string;
    isRequired: boolean;
    scaleLeftLabel: string | null;
    scaleRightLabel: string | null;
    options: CollectionQuestionOption[];
    // Arquivos enviados pelo aplicativo para esta pergunta (fotos ou áudio); vazio nas coletas antigas e nos outros tipos.
    files: CollectionMediaFile[];
    // Os arquivos que a resposta cita, cada um com "chegou ou não" (os arquivos sobem depois das respostas).
    expectedFiles: CollectionExpectedFile[];
    // Valor bruto gravado pelo aplicativo; null quando a pergunta ficou sem resposta.
    answer: string | null;
}

export interface CollectionSection {
    id: number;
    title: string;
    questions: CollectionQuestion[];
}

// Resumo dos arquivos da coleta: quantos já chegaram e quantos faltam.
export interface CollectionFilesSummary {
    expected: number;
    received: number;
    missing: number;
    complete: boolean;
    interviewAudio: { expected: boolean; received: boolean };
}

export interface CollectionDetail extends CollectionSummary {
    filesSummary: CollectionFilesSummary;
    sections: CollectionSection[];
}

/** Converte a resposta de erro da API em um `Error` com a mensagem e o status. */
const readError = async (response: Response, fallback: string) => {
    const errorBody = await response.json().catch(() => null);
    const message = Array.isArray(errorBody?.message) ? errorBody.message.join(', ') : errorBody?.message;
    const error = new Error(message || fallback) as Error & { status?: number };
    error.status = response.status;
    return error;
};

/** Lista as coletas de uma pesquisa. */
export const getCollections = async (researchId: number): Promise<CollectionSummary[]> => {
    const response = await apiFetch(`/collection?researchId=${researchId}`, {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) throw await readError(response, 'Falha ao carregar as coletas');

    return response.json();
};

/** Uma página das coletas da pesquisa (busca, gravação e ordem no servidor). */
export const getCollectionsPage = async (
    researchId: number,
    params: PageParams & { audio?: 'AUDIO' | 'NO_AUDIO' },
): Promise<Page<CollectionSummary>> => {
    const response = await apiFetch(`/collection${pageQuery(params, { researchId })}`, {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) throw await readError(response, 'Falha ao carregar as coletas');

    return asPage<CollectionSummary>(await response.json(), params);
};

export interface CollectionStats {
    total: number;
    withAudio: number;
    /** Quantos pesquisadores já enviaram coletas. */
    researchers: number;
    lastAt: string | null;
}

/** Totais da pesquisa (recebidas, com gravação, pesquisadores, última), sem trazer as coletas. */
export const getCollectionStats = async (researchId: number): Promise<CollectionStats> => {
    const response = await apiFetch(`/collection/stats?researchId=${researchId}`, { method: 'GET', credentials: 'include' });
    if (!response.ok) throw await readError(response, 'Falha ao carregar os totais das coletas');
    return response.json();
};

/** Abre uma coleta com as respostas, na ordem do questionário. */
export const getCollection = async (collectionId: number): Promise<CollectionDetail> => {
    const response = await apiFetch(`/collection/${collectionId}`, {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) throw await readError(response, 'Falha ao carregar as respostas da coleta');

    return response.json();
};

/** Baixa uma foto ou um áudio de resposta pela API autenticada (o arquivo nunca é público). */
export const getCollectionMedia = async (collectionId: number, name: string): Promise<Blob> => {
    const response = await apiFetch(`/collection/${collectionId}/media/${encodeURIComponent(name)}`, {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) throw await readError(response, 'Falha ao carregar o arquivo da resposta');

    return response.blob();
};

/** Baixa o áudio de uma coleta pela API autenticada (o arquivo nunca é público). */
export const getCollectionAudio = async (collectionId: number): Promise<Blob> => {
    const response = await apiFetch(`/collection/${collectionId}/audio`, {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) throw await readError(response, 'Falha ao carregar o áudio da coleta');

    const blob = await response.blob();
    // O player só toca se o arquivo tiver um tipo de áudio: se o cabeçalho vier sem ele, assume o do app (m4a).
    return blob.type.startsWith('audio/') ? blob : new Blob([blob], { type: 'audio/mp4' });
};

/** 3725 -> "1:02:05"; 65 -> "1:05" */
export const formatDuration = (totalSeconds: number | null): string => {
    if (totalSeconds === null || totalSeconds === undefined) return '-';
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const ss = String(seconds).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
};

// Resposta pronta para exibir. Cada tipo de pergunta chega do aplicativo num formato próprio.
export type FormattedAnswer =
    | { kind: 'empty' }
    | { kind: 'text'; text: string }
    | { kind: 'list'; items: string[] }
    | { kind: 'scale'; value: number; leftLabel: string | null; rightLabel: string | null }
    | { kind: 'location'; latitude: number; longitude: number; accuracy: number | null; lowAccuracy: boolean }
    | { kind: 'file'; names: string[] };

/** Lê um texto como JSON; devolve `null` se for inválido. */
const parseJson = (raw: string): unknown => {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

/** "2026-10-18" -> "18/10/2026" (sem passar por Date, que deslocaria o dia pelo fuso) */
const formatIsoDate = (raw: string) => {
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : raw;
};

/**
 * Converte a resposta de uma questão no formato pronto para exibir (vazio, texto, escolhas,
 * localização, mídia...).
 */
export const formatAnswer = (question: CollectionQuestion): FormattedAnswer => {
    const raw = question.answer;
    if (raw === null || raw.trim() === '') return { kind: 'empty' };

    const optionText = (id: number | string) =>
        question.options.find((option) => String(option.id) === String(id))?.text ?? String(id);

    switch (question.type) {
        case 'YES_NO':
            return { kind: 'text', text: raw === 'YES' ? 'Sim' : raw === 'NO' ? 'Não' : raw };

        case 'DATE':
            return { kind: 'text', text: formatIsoDate(raw) };

        case 'SINGLE_CHOICE':
            return { kind: 'text', text: optionText(raw) };

        case 'MULTIPLE_CHOICE': {
            const parsed = parseJson(raw);
            if (!Array.isArray(parsed)) return { kind: 'text', text: optionText(raw) };
            return parsed.length === 0
                ? { kind: 'empty' }
                : { kind: 'list', items: parsed.map((id) => optionText(id as number | string)) };
        }

        case 'SCALE_1_5': {
            const value = Number(raw);
            if (!Number.isFinite(value)) return { kind: 'text', text: raw };
            return { kind: 'scale', value, leftLabel: question.scaleLeftLabel, rightLabel: question.scaleRightLabel };
        }

        case 'LOCATION': {
            const parsed = parseJson(raw) as {
                latitude?: unknown;
                longitude?: unknown;
                accuracy?: unknown;
                lowAccuracy?: unknown;
            } | null;
            if (typeof parsed?.latitude !== 'number' || typeof parsed?.longitude !== 'number') {
                return { kind: 'text', text: raw };
            }
            return {
                kind: 'location',
                latitude: parsed.latitude,
                longitude: parsed.longitude,
                accuracy: typeof parsed.accuracy === 'number' ? parsed.accuracy : null,
                lowAccuracy: parsed.lowAccuracy === true,
            };
        }

        // A resposta guarda o nome do arquivo no aparelho; os arquivos em si vêm em `question.files`.
        case 'PHOTO':
        case 'AUDIO':
            return { kind: 'file', names: [raw] };

        case 'MULTIPLE_PHOTOS': {
            const parsed = parseJson(raw);
            return { kind: 'file', names: Array.isArray(parsed) ? parsed.map(String) : [raw] };
        }

        default:
            return { kind: 'text', text: raw };
    }
};

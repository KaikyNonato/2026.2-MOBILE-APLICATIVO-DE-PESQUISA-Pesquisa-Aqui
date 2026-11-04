import { File } from 'expo-file-system';
import { apiFetch } from "./api";

/**
 * Parte de arquivo para o FormData. O fetch do Expo não aceita o formato antigo do React Native
 * ({ uri, name, type }): só texto, Blob ou um objeto com `bytes()`. Aqui o arquivo é lido do
 * aparelho
 * no momento do envio, e nome e tipo ficam sob controle do app (o servidor valida o tipo do áudio).
 * O File só lê endereço com esquema (file://, content://)
 */
const toFileUri = (uri: string) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri) ? uri : `file://${uri}`);

/** Tamanho do arquivo no aparelho, em bytes (0 se não existe). */
export const fileSizeOf = (uri: string): number => new File(toFileUri(uri)).size;

/**
 * Monta a parte de arquivo de um envio multipart a partir de um arquivo local, lendo os bytes só na
 * hora de enviar.
 */
export function filePart(uri: string, name: string, type: string): Blob {
    const file = new File(toFileUri(uri));
    return { name, type, bytes: () => file.bytes() } as unknown as Blob;
}

export interface CollectionAnswer {
    questionId: number;
    // Respostas compostas (múltipla escolha, localização...) vão serializadas como texto
    value: string;
}

// Aceite do entrevistado, registrado no aparelho antes de a coleta começar.
export interface InterviewConsent {
    accepted: true;
    acceptedAt: string; // ISO 8601
}

// Momento em que a gravação da entrevista parou sem o pesquisador pedir (ligação, falta de espaço...).
export interface RecordingIssue {
    at: string; // ISO 8601
    reason: 'stopped' | 'error' | 'low-space';
    resumedAt?: string; // ISO 8601, só existe se o pesquisador conseguiu retomar
}

export interface CollectionAudio {
    uri: string;
    durationSeconds: number;
    mimeType?: string;
    // true = a gravação teve interrupções: o áudio tem lacunas e o servidor/web devem tratá-lo como incompleto
    hasGaps?: boolean;
}

// Áudio de uma questão "responda falando". O arquivo já está guardado no aparelho.
export interface CollectionQuestionAudio {
    questionId: number;
    uri: string;
    // Nome do arquivo: é o valor que a resposta da questão guarda, para o servidor ligar arquivo e questão
    name: string;
    mimeType: string;
    durationSeconds: number;
}

// Foto tirada numa questão de foto / várias fotos. O arquivo já está reduzido e guardado no aparelho.
export interface CollectionPhoto {
    questionId: number;
    uri: string;
    // Nome do arquivo: é o valor que a resposta da questão guarda, para o servidor ligar arquivo e questão
    name: string;
    mimeType: string;
}

export interface CollectionInput {
    researchId: number;
    // Identificador único da coleta no aparelho: reenviar a mesma coleta não a duplica no servidor
    clientId: string;
    deviceId?: string;
    startedAt: string;
    finishedAt: string;
    answers: CollectionAnswer[];
    // Local onde a entrevista começou (GPS). Ausente = sem permissão ou sem sinal.
    startLocation?: { latitude: number; longitude: number; accuracy: number | null } | null;
    consent?: InterviewConsent;
    audio?: CollectionAudio;
    recordingIssues?: RecordingIssue[];
    photos?: CollectionPhoto[];
    questionAudios?: CollectionQuestionAudio[];
}

/** O servidor recusou a coleta por falta do consentimento registrado (pesquisa com gravação). */
export class ConsentRequiredError extends Error { }

/**
 * Monta o multipart da coleta: o campo `payload` (JSON) e um campo por tipo de arquivo.
 * O servidor liga cada arquivo à sua questão pela POSIÇÃO: `payload.photos[i]` descreve o i-ésimo
 * `photos`,
 * e `payload.questionAudios[i]` o i-ésimo `questionAudios`. Por isso a lista e os arquivos saem do
 * mesmo laço,
 * na mesma ordem, e não dependem de o nome do arquivo chegar intacto ao servidor.
 */
export function buildCollectionFormData(input: CollectionInput): FormData {
    const photos = input.photos ?? [];
    const questionAudios = input.questionAudios ?? [];

    const payload = {
        researchId: input.researchId,
        clientId: input.clientId,
        deviceId: input.deviceId,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        answers: input.answers,
        startLocation: input.startLocation ?? undefined,
        consent: input.consent,
        audioDurationSeconds: input.audio ? Math.round(input.audio.durationSeconds) : undefined,
        photos: photos.map(({ questionId, name }) => ({ questionId, name })),
        questionAudios: questionAudios.map(({ questionId, name, durationSeconds }) => ({
            questionId,
            name,
            durationSeconds: Math.round(durationSeconds),
        })),
    };

    const form = new FormData();
    form.append('payload', JSON.stringify(payload));

    if (input.audio) {
        form.append(
            'audio',
            filePart(input.audio.uri, `coleta-${input.clientId}.m4a`, input.audio.mimeType ?? 'audio/mp4'),
        );
    }

    for (const photo of photos) {
        form.append('photos', filePart(photo.uri, photo.name, photo.mimeType));
    }

    for (const audio of questionAudios) {
        form.append('questionAudios', filePart(audio.uri, audio.name, audio.mimeType));
    }

    return form;
}

// Um arquivo da coleta que sobe sozinho, depois das respostas.
export interface UploadFile {
    // Identifica o arquivo na fila do aparelho: não muda entre tentativas
    key: string;
    uri: string;
    // Nome no aparelho (o valor guardado na resposta): o servidor o usa para não gravar duas vezes
    name: string;
    mimeType: string;
    // Sem questão = áudio da entrevista
    questionId?: number;
    durationSeconds?: number;
    label: string; // para mensagens ("foto", "áudio", "áudio da entrevista")
}

/** Todos os arquivos que a coleta precisa enviar, na ordem: entrevista, fotos, áudios das questões. */
export function listUploadFiles(input: CollectionInput): UploadFile[] {
    const files: UploadFile[] = [];
    if (input.audio) {
        files.push({
            key: 'interview',
            uri: input.audio.uri,
            name: `coleta-${input.clientId}.m4a`,
            mimeType: input.audio.mimeType ?? 'audio/mp4',
            durationSeconds: Math.round(input.audio.durationSeconds),
            label: 'áudio da entrevista',
        });
    }
    for (const photo of input.photos ?? []) {
        files.push({
            key: `photo:${photo.questionId}:${photo.name}`,
            uri: photo.uri,
            name: photo.name,
            mimeType: photo.mimeType,
            questionId: photo.questionId,
            label: 'foto',
        });
    }
    for (const audio of input.questionAudios ?? []) {
        files.push({
            key: `audio:${audio.questionId}:${audio.name}`,
            uri: audio.uri,
            name: audio.name,
            mimeType: audio.mimeType,
            questionId: audio.questionId,
            durationSeconds: Math.round(audio.durationSeconds),
            label: 'áudio',
        });
    }
    return files;
}

/**
 * Multipart de UM arquivo (POST /collection/:clientId/files): o arquivo e os campos que o ligam à
 * coleta.
 */
export function buildFileFormData(file: UploadFile): FormData {
    const form = new FormData();
    form.append('name', file.name);
    if (file.questionId !== undefined) form.append('questionId', String(file.questionId));
    if (file.durationSeconds !== undefined) form.append('durationSeconds', String(file.durationSeconds));
    form.append('file', filePart(file.uri, file.name, file.mimeType));
    return form;
}

/** Tamanho de cada pedaço enviado. Pequeno o bastante para caber numa rede ruim, grande o bastante para não virar enxurrada de requisições. */
export const UPLOAD_CHUNK_BYTES = 1024 * 1024;

/** Parte de arquivo montada de bytes que já estão na memória (um pedaço do arquivo). */
function bytesPart(bytes: Uint8Array, name: string, type: string): Blob {
    return { name, type, bytes: async () => bytes } as unknown as Blob;
}

/** Query de GET /collection/:clientId/files/progress: "quanto deste arquivo o servidor já tem?" */
export function buildProgressQuery(file: UploadFile, totalBytes: number): string {
    const params = new URLSearchParams({ name: file.name, totalBytes: String(totalBytes) });
    if (file.questionId !== undefined) params.set('questionId', String(file.questionId));
    return params.toString();
}

/**
 * Multipart de UM PEDAÇO (POST /collection/:clientId/files/chunk): os mesmos campos que identificam
 * o arquivo
 * no envio inteiro, mais a posição do pedaço (`offset`) e o tamanho do arquivo todo (`totalBytes`).
 */
export function buildChunkFormData(file: UploadFile, offset: number, totalBytes: number, bytes: Uint8Array): FormData {
    const form = new FormData();
    form.append('name', file.name);
    if (file.questionId !== undefined) form.append('questionId', String(file.questionId));
    if (file.durationSeconds !== undefined) form.append('durationSeconds', String(file.durationSeconds));
    form.append('mimeType', file.mimeType);
    form.append('offset', String(offset));
    form.append('totalBytes', String(totalBytes));
    form.append('file', bytesPart(bytes, file.name, file.mimeType));
    return form;
}

/** Lê `length` bytes do arquivo a partir de `offset`, sem carregar o arquivo inteiro na memória. */
export async function readFileChunk(uri: string, offset: number, length: number): Promise<Uint8Array> {
    const handle = new File(toFileUri(uri)).open();
    try {
        handle.offset = offset;
        return await handle.readBytes(length);
    } finally {
        handle.close();
    }
}

/** Envia a coleta: respostas, consentimento (data, hora) e o áudio, tudo na mesma requisição. */
export async function uploadCollection(input: CollectionInput) {
    const response = await apiFetch('/collection', {
        method: 'POST',
        body: buildCollectionFormData(input),
    });

    if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (body?.code === 'CONSENT_REQUIRED') throw new ConsentRequiredError(body.message);
        throw new Error(
            Array.isArray(body?.message) ? body.message.join(', ') : body?.message || 'Falha ao enviar a coleta'
        );
    }

    return response.json();
}

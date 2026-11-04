import { File } from 'expo-file-system';
import { ApiError, apiFetch } from './api';
import {
    buildChunkFormData,
    buildProgressQuery,
    fileSizeOf,
    listUploadFiles,
    readFileChunk,
    UPLOAD_CHUNK_BYTES,
    type CollectionInput,
    type UploadFile,
} from './collectionUpload';
import type { SendOutcome } from './syncEngine';

// Envio de UMA coleta ao servidor. Nunca lança erro: tudo vira um SendOutcome para a fila decidir.
//
// O envio é separado em duas etapas, para um arquivo pesado nunca travar a fila:
//  1. POST /collection/sync (JSON): as respostas, sem arquivo. Idempotente pelo clientId (UUID do aparelho);
//     responde ACCEPTED, ALREADY_EXISTS ou REJECTED com motivo.
//  2. Arquivos (foto, áudio de questão ou áudio da entrevista), um de cada vez, ligados à coleta pelo UUID e à
//     questão. Cada arquivo sobe em pedaços de 1 MB (POST /collection/:clientId/files/chunk): se a rede cai no meio,
//     a próxima tentativa pergunta ao servidor quanto ele já tem (GET .../files/progress) e continua dali, em vez
//     de recomeçar. Reenviar um arquivo que o servidor já tem não duplica.

const SYNC_TIMEOUT_MS = 30_000;
const CHUNK_TIMEOUT_MS = 60_000; // um pedaço de 1 MB: se não passa em 1 minuto, a rede não está servindo

/** Erro interno que indica que o servidor não foi alcançado (sem rede ou tempo esgotado). */
class Unreachable extends Error { }

/** Faz a requisição à API com tempo limite: passado `timeoutMs`, ela é cancelada. */
async function request(method: 'GET' | 'POST', path: string, body: BodyInit | undefined, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await apiFetch(path, { method, body, signal: controller.signal });
    } catch (error) {
        if (error instanceof ApiError) throw error; // sessão expirada
        // O motivo real (ex.: arquivo ilegível, conexão encerrada pelo servidor) só aparece aqui, no log do Expo
        console.log(`Falha de rede em ${method} ${path}:`, error);
        throw new Unreachable(
            controller.signal.aborted
                ? 'O servidor demorou demais para responder.'
                : 'Sem conexão com o servidor.',
        );
    } finally {
        clearTimeout(timer);
    }
}

/** Atalho de `request` com o método POST. */
const post = (path: string, body: BodyInit, timeoutMs: number) => request('POST', path, body, timeoutMs);

/**
 * Resposta de erro do servidor (400, 403, 404, 5xx...). Falha temporária é a que vale tentar de
 * novo sozinho.
 */
async function failureFromHttp(response: Response): Promise<SendOutcome> {
    const body = await response.json().catch(() => null);
    const message: string | undefined = Array.isArray(body?.message) ? body.message.join(' ') : body?.message;
    const temporary = response.status >= 500 || response.status === 408 || response.status === 429;

    // Erro temporário: o texto do servidor é genérico e em inglês ("Internal server error"), então usa o do app.
    // Recusa (4xx): o servidor explica o motivo em português ("Você não está vinculado a esta pesquisa.").
    const reason = temporary
        ? 'O servidor teve um problema ao receber a coleta. O app tenta de novo sozinho.'
        : message || `O servidor recusou a coleta (erro ${response.status}).`;

    return {
        kind: 'failed',
        reason,
        code: typeof body?.code === 'string' ? body.code : undefined,
        retryable: temporary,
    };
}

// ---------- Sem arquivo: POST /collection/sync ----------

interface SyncResult {
    clientId?: string | null;
    status?: string;
    code?: string;
    reason?: string;
    retryable?: boolean;
}

/** Envia a coleta pela rota de sincronização, que aceita lote (aqui, uma coleta por vez). */
async function sendViaSync(input: CollectionInput): Promise<SendOutcome> {
    const body = JSON.stringify({
        deviceId: input.deviceId ?? 'desconhecido',
        collections: [
            {
                clientId: input.clientId,
                researchId: input.researchId,
                startedAt: input.startedAt,
                finishedAt: input.finishedAt,
                consent: input.consent,
                startLocation: input.startLocation ?? undefined,
                answers: input.answers,
            },
        ],
    });

    const response = await post('/collection/sync', body, SYNC_TIMEOUT_MS);
    if (!response.ok) return failureFromHttp(response);

    const data = await response.json().catch(() => null);
    const results: SyncResult[] = Array.isArray(data?.results) ? data.results : [];
    // Casa pelo identificador da coleta, não pela posição
    const result = results.find((r) => r.clientId?.toLowerCase() === input.clientId.toLowerCase());

    if (result?.status === 'ACCEPTED') return { kind: 'confirmed', alreadyExisted: false };
    if (result?.status === 'ALREADY_EXISTS') return { kind: 'confirmed', alreadyExisted: true };
    if (result?.status === 'REJECTED') {
        return {
            kind: 'failed',
            reason: result.reason || 'O servidor recusou esta coleta.',
            code: result.code,
            retryable: result.retryable === true,
        };
    }
    return { kind: 'failed', reason: 'Resposta do servidor não reconhecida. Tente novamente.', retryable: true };
}

// ---------- Arquivos: POST /collection/:clientId/files (um por requisição) ----------

/** Diz se o arquivo existe no aparelho (`false` se der erro). */
function fileExists(uri: string): boolean {
    try {
        return new File(uri).exists;
    } catch {
        return false;
    }
}

/** Apaga o arquivo sem lançar erro (ignora se não existir ou se falhar). */
function removeFileQuietly(uri: string): void {
    try {
        const file = new File(uri);
        if (file.exists) file.delete();
    } catch {
        // arquivo que o sistema não deixa apagar não atrapalha o envio
    }
}

/** Resultado de subir um arquivo: chegou inteiro, ou a resposta do servidor que o recusou / deu erro. */
type FileUploadResult = { done: true } | { done: false; response: Response };

/**
 * Sobe UM arquivo em pedaços, continuando de onde o servidor parou.
 * Arquivo maior que um pedaço começa perguntando quanto o servidor já tem (uma tentativa anterior pode ter
 * subido parte dele). O servidor é quem manda: se ele diz que tem N bytes, o próximo pedaço começa em N,
 * mesmo que o app achasse outra coisa (resposta perdida, pedaço repetido, arquivo parcial descartado).
 */
async function uploadFileInChunks(clientId: string, file: UploadFile): Promise<FileUploadResult> {
    const base = `/collection/${encodeURIComponent(clientId)}/files`;
    const total = fileSizeOf(file.uri);

    let offset = 0;
    if (total > UPLOAD_CHUNK_BYTES) {
        const progress = await request('GET', `${base}/progress?${buildProgressQuery(file, total)}`, undefined, SYNC_TIMEOUT_MS);
        if (!progress.ok) return { done: false, response: progress };
        const data = await progress.json().catch(() => null);
        const received = Number(data?.receivedBytes);
        if (Number.isFinite(received)) offset = Math.min(Math.max(0, Math.floor(received)), total);
    }

    // Trava contra servidor que nunca avança: o normal é um pedaço por volta.
    const maxRounds = Math.ceil(total / UPLOAD_CHUNK_BYTES) + 20;
    for (let round = 0; round < maxRounds; round++) {
        const length = Math.min(UPLOAD_CHUNK_BYTES, total - offset);
        const bytes = await readFileChunk(file.uri, offset, length);
        if (bytes.length !== length) throw new Error(`Leitura incompleta de ${file.name} (${bytes.length} de ${length} bytes)`);

        const response = await post(`${base}/chunk`, buildChunkFormData(file, offset, total, bytes), CHUNK_TIMEOUT_MS);
        if (!response.ok) return { done: false, response };

        const data = await response.json().catch(() => null);
        if (data?.status === 'ACCEPTED' || data?.status === 'ALREADY_EXISTS') return { done: true };
        if (data?.status !== 'PARTIAL' || !Number.isFinite(Number(data.receivedBytes))) break;
        offset = Math.min(Math.max(0, Math.floor(Number(data.receivedBytes))), total);
    }
    throw new Error(`O servidor não confirmou o arquivo ${file.name}`);
}

/**
 * Envia os arquivos da coleta que o servidor ainda não tem, um a um. A coleta (respostas) já chegou antes.
 * - cada arquivo sobe em pedaços e continua de onde parou (uploadFileInChunks);
 * - arquivo que o servidor já recebeu (resposta ALREADY_EXISTS) conta como enviado: não duplica;
 * - falha de rede ou do servidor para na hora (o que já subiu não sobe de novo na próxima rodada);
 * - recusa definitiva de um arquivo (tipo, tamanho) não impede os outros: a coleta fica na fila com o motivo.
 */
export async function sendCollectionFiles(
    input: CollectionInput,
    uploadedKeys: string[],
    onUploaded: (key: string) => Promise<void>,
): Promise<SendOutcome> {
    try {
        let refusal: SendOutcome | null = null;

        for (const file of listUploadFiles(input)) {
            if (uploadedKeys.includes(file.key)) continue;

            // Arquivo que sumiu do aparelho não tem como ser reenviado: não prende a coleta na fila para sempre.
            if (!fileExists(file.uri)) {
                await onUploaded(file.key);
                continue;
            }

            const result = await uploadFileInChunks(input.clientId, file);

            if (!result.done) {
                const failure = await failureFromHttp(result.response);
                if (failure.kind === 'failed' && failure.code === 'COLLECTION_NOT_RECEIVED') {
                    // O servidor não tem a coleta: quem chama volta a enviar as respostas primeiro.
                    return { ...failure, reason: 'O servidor não encontrou esta coleta. As respostas serão enviadas de novo.', retryable: true };
                }
                if (failure.kind === 'failed' && !failure.retryable) {
                    refusal = { ...failure, reason: `O servidor recusou ${file.label}: ${failure.reason}` };
                    continue;
                }
                return failure;
            }

            await onUploaded(file.key);
            removeFileQuietly(file.uri); // já está no servidor: libera o espaço do aparelho
        }

        return refusal ?? { kind: 'confirmed', alreadyExisted: false };
    } catch (error) {
        if (error instanceof ApiError && error.status === 401) return { kind: 'auth' };
        if (error instanceof Unreachable) return { kind: 'unreachable', reason: error.message };
        console.log('Falha inesperada ao enviar os arquivos da coleta:', error);
        return { kind: 'failed', reason: 'Erro inesperado ao enviar os arquivos. Tente novamente.', retryable: true };
    }
}

// ---------- Entrada ----------

/** Etapa 1: as respostas da coleta (sem arquivos) chegam primeiro. */
export async function sendCollection(input: CollectionInput): Promise<SendOutcome> {
    try {
        return await sendViaSync(input);
    } catch (error) {
        if (error instanceof ApiError && error.status === 401) return { kind: 'auth' };
        if (error instanceof Unreachable) return { kind: 'unreachable', reason: error.message };
        console.log('Falha inesperada ao enviar a coleta:', error);
        return { kind: 'failed', reason: 'Erro inesperado ao enviar a coleta. Tente novamente.', retryable: true };
    }
}

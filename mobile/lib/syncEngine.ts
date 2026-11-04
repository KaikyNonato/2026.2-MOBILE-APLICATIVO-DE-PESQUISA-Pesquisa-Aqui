import type { SendFailure } from './collectionStore';

// Motor da fila de envio. Não conhece React, tela, rede nem armazenamento: recebe tudo de fora (SyncDeps).
// A ligação com o aparelho e com a API está em syncQueue.ts.
//
// Regras:
// - uma rodada por vez: pedir outra enquanto uma roda devolve a mesma rodada (não envia a coleta duas vezes);
// - as coletas vão uma a uma, da mais antiga para a mais nova;
// - o que o servidor confirma sai da fila; o que falha fica, com o motivo guardado;
// - se a conexão cai (ou a sessão expira), a rodada para na hora: o resto da fila fica intacta, sem culpa;
// - o envio tem duas etapas: primeiro as respostas de TODAS as coletas, depois os arquivos (fotos e áudios),
//   um a um. Assim um arquivo pesado, ou uma rede ruim, nunca atrasa a chegada das respostas;
// - a coleta só sai da fila quando as respostas E todos os arquivos foram confirmados. Um arquivo que falha é
//   reenviado sozinho na próxima rodada, sem mandar a coleta inteira de novo;
// - nada aqui apaga coleta sem confirmação do servidor. Interrompido no meio, o reenvio repete o mesmo
//   identificador (clientId) e o servidor responde "já existia": não duplica.

/** Quanto o envio automático espera para tentar de novo uma coleta que falhou (evita martelar o servidor). */
export const AUTO_RETRY_AFTER_MS = 30_000;

export type SendOutcome =
    // Servidor guardou a coleta (alreadyExisted = já tinha recebido num envio anterior)
    | { kind: 'confirmed'; alreadyExisted: boolean }
    // Servidor recusou ou deu erro nesta coleta: ela fica na fila com o motivo
    | { kind: 'failed'; reason: string; code?: string; retryable: boolean }
    // Sem conexão ou servidor sem responder: registra o motivo na coleta e interrompe a rodada
    | { kind: 'unreachable'; reason: string }
    // Sessão expirada: interrompe a rodada sem culpar a coleta
    | { kind: 'auth' };

export interface QueueEntry {
    clientId: string;
    lastFailure?: SendFailure;
    /** As respostas já chegaram ao servidor; falta (no máximo) enviar arquivos. */
    collectionSent?: boolean;
}

export interface SyncDeps {
    /** Coletas finalizadas e ainda não confirmadas, a mais antiga primeiro. */
    listQueue(): Promise<QueueEntry[]>;
    /** Etapa 1: lê a coleta, monta o envio e manda as respostas ao servidor. Não lança erro. */
    send(clientId: string): Promise<SendOutcome>;
    /** O servidor recebeu as respostas. Devolve true se ainda há arquivos para enviar (etapa 2). */
    onCollectionSent(clientId: string): Promise<boolean>;
    /** Etapa 2: envia os arquivos que ainda faltam, um a um. "confirmed" = todos chegaram. Não lança erro. */
    sendFiles(clientId: string): Promise<SendOutcome>;
    /** O servidor confirmou: tira a coleta do aparelho. */
    onConfirmed(clientId: string): Promise<void>;
    /** Guarda o motivo da falha na coleta. */
    onFailed(clientId: string, failure: SendFailure): Promise<void>;
    /** O aparelho está com rede? Distingue "sem sinal" (para a rodada) de uma coleta que falha sozinha. */
    isOnline?(): Promise<boolean>;
    now?: () => number;
}

/** Falhas de conexão seguidas, com o aparelho dizendo que tem rede, até desistir da rodada. */
export const MAX_CONSECUTIVE_UNREACHABLE = 3;

export type Trigger = 'auto' | 'manual';

export interface RunSummary {
    finishedAt: string; // ISO 8601
    trigger: Trigger;
    confirmed: number;
    failed: number;
    /** Por que a rodada parou antes do fim da fila (null = chegou ao fim). */
    stoppedBy: 'unreachable' | 'auth' | 'error' | null;
    stopReason: string | null;
}

export interface SyncState {
    /** Sobe a cada mudança: a tela recarrega a fila quando ele muda. */
    version: number;
    running: boolean;
    trigger: Trigger | null;
    /** Coletas desta rodada e quantas já foram tratadas. */
    total: number;
    done: number;
    /** Coletas da rodada que ainda não terminaram: aguardando a vez ou sendo enviada agora. */
    items: Record<string, 'waiting' | 'sending'>;
    lastRun: RunSummary | null;
}

const IDLE: Omit<SyncState, 'version' | 'lastRun'> = { running: false, trigger: null, total: 0, done: 0, items: {} };

/**
 * Cria o motor de sincronização: roda a fila de envio de coletas (automática ou manual), guarda o
 * estado e avisa quem assina.
 */
export function createSyncEngine(deps: SyncDeps) {
    const now = deps.now ?? Date.now;
    const listeners = new Set<() => void>();
    let state: SyncState = { ...IDLE, version: 0, lastRun: null };
    let current: Promise<RunSummary> | null = null;

    // O estado nunca é alterado no lugar: cada mudança cria um objeto novo (o React compara por referência).
    const update = (patch: Partial<SyncState>) => {
        state = { ...state, ...patch, version: state.version + 1 };
        listeners.forEach((listener) => listener());
    };

    const isEligible = (entry: QueueEntry, trigger: Trigger, only?: string) => {
        if (only) return entry.clientId === only;
        if (trigger === 'manual') return true; // "enviar agora" tenta tudo, inclusive recusas definitivas
        const failure = entry.lastFailure;
        if (!failure) return true;
        if (!failure.retryable) return false; // recusa definitiva: só o pesquisador reenvia
        return now() - Date.parse(failure.at) >= AUTO_RETRY_AFTER_MS;
    };

    /** Executa uma rodada de envio (da fila toda ou de uma coleta só) e devolve o resumo. */
    async function execute(trigger: Trigger, only?: string): Promise<RunSummary> {
        const summary: RunSummary = {
            finishedAt: new Date(now()).toISOString(),
            trigger,
            confirmed: 0,
            failed: 0,
            stoppedBy: null,
            stopReason: null,
        };

        let queue: QueueEntry[];
        try {
            queue = (await deps.listQueue()).filter((entry) => isEligible(entry, trigger, only));
        } catch (error) {
            console.log('Falha ao ler a fila de envio:', error);
            return { ...summary, stoppedBy: 'error', stopReason: 'Não foi possível ler a fila de envio do aparelho.' };
        }

        // Nada a enviar (comum no envio automático): não mexe no estado, a tela não pisca
        if (queue.length === 0) return summary;

        update({
            running: true,
            trigger,
            total: queue.length,
            done: 0,
            items: Object.fromEntries(queue.map((entry) => [entry.clientId, 'waiting' as const])),
        });

        let unreachableInRow = 0;
        let stopped = false;

        const finishEntry = (entry: QueueEntry) => {
            const remaining = { ...state.items };
            delete remaining[entry.clientId];
            update({ items: remaining, done: state.done + 1 });
        };

        // Resultado de uma etapa. Devolve "confirmed" quando a etapa deu certo; senão registra a falha.
        // Define `stopped` quando a rodada inteira deve parar (sessão expirada ou sem conexão).
        const settle = async (
            entry: QueueEntry,
            run: () => Promise<SendOutcome>,
        ): Promise<Extract<SendOutcome, { kind: 'confirmed' }> | null> => {
            update({ items: { ...state.items, [entry.clientId]: 'sending' } });

            let outcome: SendOutcome;
            try {
                outcome = await run();
            } catch (error) {
                console.log(`Falha inesperada ao enviar a coleta ${entry.clientId}:`, error);
                outcome = { kind: 'failed', reason: 'Erro inesperado ao enviar a coleta. Tente novamente.', retryable: true };
            }

            if (outcome.kind === 'auth') {
                summary.stoppedBy = 'auth';
                summary.stopReason = 'Sua sessão expirou. Entre de novo para enviar as coletas.';
                stopped = true;
                return null;
            }

            if (outcome.kind === 'confirmed') {
                unreachableInRow = 0;
                return outcome;
            }

            summary.failed += 1;
            const failure: SendFailure =
                outcome.kind === 'failed'
                    ? { reason: outcome.reason, code: outcome.code, retryable: outcome.retryable, at: new Date(now()).toISOString() }
                    : { reason: outcome.reason, retryable: true, at: new Date(now()).toISOString() };
            try {
                await deps.onFailed(entry.clientId, failure);
            } catch (error) {
                console.log(`Falha ao guardar o motivo da coleta ${entry.clientId}:`, error);
            }

            if (outcome.kind === 'unreachable') {
                unreachableInRow += 1;
                // Sem rede de verdade: para. Com rede, o problema pode ser só desta coleta (um arquivo
                // que não sobe, por exemplo): ela fica com o motivo e a fila segue, para uma coleta
                // não travar todas as outras. Se falhar várias seguidas, o servidor está fora: para.
                const online = deps.isOnline ? await deps.isOnline().catch(() => false) : false;
                if (!online || unreachableInRow >= MAX_CONSECUTIVE_UNREACHABLE) {
                    summary.stoppedBy = 'unreachable';
                    summary.stopReason = outcome.reason;
                    stopped = true;
                }
            } else {
                unreachableInRow = 0;
            }

            finishEntry(entry);
            return null;
        };

        const confirmEntry = async (entry: QueueEntry) => {
            summary.confirmed += 1;
            try {
                await deps.onConfirmed(entry.clientId);
            } catch (error) {
                // A coleta fica na fila; no próximo envio o servidor responde "já existia" e ela sai.
                console.log(`Falha ao tirar a coleta ${entry.clientId} da fila:`, error);
            }
            finishEntry(entry);
        };

        try {
            const awaitingFiles: QueueEntry[] = queue.filter((entry) => entry.collectionSent);

            // Etapa 1: as respostas de todas as coletas, antes de qualquer arquivo.
            for (const entry of queue) {
                if (stopped) break;
                if (entry.collectionSent) continue;

                const confirmed = await settle(entry, () => deps.send(entry.clientId));
                if (!confirmed) continue;

                let hasFiles = false;
                try {
                    hasFiles = await deps.onCollectionSent(entry.clientId);
                } catch (error) {
                    console.log(`Falha ao registrar o envio da coleta ${entry.clientId}:`, error);
                }

                if (hasFiles) {
                    update({ items: { ...state.items, [entry.clientId]: 'waiting' } });
                    awaitingFiles.push(entry);
                } else {
                    await confirmEntry(entry);
                }
            }

            // Etapa 2: os arquivos, coleta a coleta. Falha de uma coleta não impede as outras.
            for (const entry of awaitingFiles) {
                if (stopped) break;
                const confirmed = await settle(entry, () => deps.sendFiles(entry.clientId));
                if (confirmed) await confirmEntry(entry);
            }
        } finally {
            summary.finishedAt = new Date(now()).toISOString();
            update({ ...IDLE, lastRun: summary });
        }

        return summary;
    }

    return {
        /**
         * Envia a fila. Se já há uma rodada em andamento, devolve a dela (nunca roda duas ao mesmo tempo).
         * `only` envia só aquela coleta ("tentar de novo"). Nunca lança erro.
         */
        run(options: { trigger: Trigger; only?: string }): Promise<RunSummary> {
            if (current) return current;
            current = execute(options.trigger, options.only).finally(() => {
                current = null;
            });
            return current;
        },
        getState: (): SyncState => state,
        /** Registra um ouvinte do estado. Devolve a função que cancela o registro. */
        subscribe(listener: () => void): () => void {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;

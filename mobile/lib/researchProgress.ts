import type { SentRecord } from './sentHistory';

// Progresso do pesquisador frente à meta, calculado no aparelho (funciona sem internet).
//
// feitas = o que o servidor tinha na última atualização da lista (`collected`)
//        + as coletas do aparelho (enviadas ou aguardando envio) que NÃO estão nessa contagem.
// Cada coleta é reconhecida pelo identificador (clientId), então nenhuma conta duas vezes,
// aconteça o envio quando acontecer em relação à atualização da lista.
// Rascunhos não contam: a coleta só vale depois de finalizada.

export interface ProgressSource {
    id: number;
    targetCount?: number | null;
    collected?: number;
    /** clientId das coletas já contadas em `collected`. Ausente (servidor antigo): usa `progressSyncedAt`. */
    collectedIds?: string[];
    progressSyncedAt?: string;
}

export interface ResearchProgress {
    done: number;
    /** Dessas, quantas ainda não chegaram ao servidor. */
    pending: number;
    /** null = o administrador não definiu meta. */
    target: number | null;
    /** Quantas faltam (nunca negativo); null sem meta. */
    remaining: number | null;
    /** 0 a 100; null sem meta. */
    percent: number | null;
}

/** Padroniza o id da coleta em minúsculas. */
const normalize = (clientId: string) => clientId.toLowerCase();

/**
 * Calcula o progresso da pesquisa no aparelho, a partir das coletas enviadas e das finalizadas que
 * ainda estão guardadas.
 */
export function computeProgress(
    research: ProgressSource,
    sent: SentRecord[],
    /** clientId das coletas finalizadas desta pesquisa que ainda estão no aparelho. */
    pendingIds: string[],
): ResearchProgress {
    const sentOfResearch = sent.filter((record) => record.researchId === research.id);

    let notCounted: number;
    if (research.collectedIds) {
        const known = new Set(research.collectedIds.map(normalize));
        const local = new Set([...sentOfResearch.map((r) => r.clientId), ...pendingIds].map(normalize));
        notCounted = [...local].filter((clientId) => !known.has(clientId)).length;
    } else {
        // Servidor sem a lista de identificadores: conta o enviado depois da atualização e o que está na fila.
        const since = research.progressSyncedAt;
        const sentAfterSync = sentOfResearch.filter((record) => !since || record.sentAt > since).length;
        notCounted = sentAfterSync + pendingIds.length;
    }

    const done = (research.collected ?? 0) + notCounted;
    const target = research.targetCount ?? null;

    return {
        done,
        pending: pendingIds.length,
        target,
        remaining: target === null ? null : Math.max(0, target - done),
        percent: target === null ? null : Math.min(100, Math.round((done / target) * 100)),
    };
}

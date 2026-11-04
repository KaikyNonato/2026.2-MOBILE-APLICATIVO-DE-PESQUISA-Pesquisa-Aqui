import { listCollections } from './collectionStore';
import { getCachedResearches, returnResearchCopy } from './researchCache';

/** Escreve o número com a palavra no singular ou no plural. */
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Coletas desta pesquisa que ainda estão no aparelho: finalizadas aguardando envio (ou com falha) e rascunhos. */
export interface PendingCollections {
    finished: number;
    drafts: number;
}

/**
 * Texto que descreve as coletas pendentes (por exemplo, "2 coletas ainda não enviadas e 1
 * rascunho").
 */
export function describePending({ finished, drafts }: PendingCollections): string {
    const parts: string[] = [];
    if (finished > 0) parts.push(plural(finished, 'coleta ainda não enviada', 'coletas ainda não enviadas'));
    if (drafts > 0) parts.push(plural(drafts, 'rascunho', 'rascunhos'));
    return parts.join(' e ');
}

/** Erro ao devolver uma pesquisa que ainda tem coletas no aparelho. */
export class PendingCollectionsError extends Error {
    pending: PendingCollections;

    constructor(pending: PendingCollections = { finished: 0, drafts: 0 }) {
        const detail = describePending(pending);
        super(
            `${detail ? `Esta pesquisa ainda tem ${detail} neste aparelho. ` : 'Esta pesquisa ainda tem coletas neste aparelho. '}` +
            'Envie tudo (ou conclua os rascunhos e envie) antes de removê-la.',
        );
        this.pending = pending;
    }
}

/** Quanto ainda há desta pesquisa no aparelho. Fila vazia = tudo zero. */
export async function getPendingCollections(id: number): Promise<PendingCollections> {
    const collections = await listCollections(id);
    const finished = collections.filter((c) => c.status === 'FINISHED').length;
    return { finished, drafts: collections.length - finished };
}

/**
 * Remove a pesquisa do aparelho e devolve a cópia ao servidor, só se não há coleta (rascunho ou ainda não
 * enviada) dessa pesquisa no aparelho. O servidor é avisado primeiro; só com a confirmação dele o pacote
 * baixado é apagado. A coleta pendente nunca é apagada por aqui.
 */
export async function returnResearchSafely(id: number): Promise<void> {
    const pending = await getPendingCollections(id);
    if (pending.finished + pending.drafts > 0) throw new PendingCollectionsError(pending);
    await returnResearchCopy(id);
}

/**
 * Devolve, sem barulho, todas as pesquisas baixadas que não têm coleta pendente (usado ao sair da conta).
 * Quem não puder (sem internet, coleta pendente) continua como cópia ativa até ser devolvida ou revogada.
 */
export async function returnAllCopies(timeoutMs = 8000): Promise<void> {
    const run = async () => {
        const downloaded = (await getCachedResearches()).filter((r) => r.isDownloaded);
        for (const research of downloaded) {
            try {
                await returnResearchSafely(research.id);
            } catch (error) {
                console.log(`Cópia da pesquisa ${research.id} não devolvida:`, error);
            }
        }
    };
    await Promise.race([run(), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

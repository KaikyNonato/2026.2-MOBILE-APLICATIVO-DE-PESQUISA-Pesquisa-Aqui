import { getCollection, removeCollection, type LocalCollection } from './collectionStore';
import { removeCollectionFiles } from './confirmedFiles';

// Descartar coleta: a saída para a coleta que o servidor recusou de vez (pesquisa encerrada, acesso revogado...)
// e nunca vai ser aceita. Sem isso ela ficaria na fila para sempre e bloquearia a remoção da pesquisa do aparelho.
//
// É a única forma de uma coleta finalizada sair do aparelho sem o servidor ter confirmado, por isso é estreita:
// - só coleta com falha DEFINITIVA (retryable = false): falha temporária se resolve com "tentar de novo";
// - não vale para "pesquisa não baixada" (PACKAGE_MISSING): baixar a pesquisa de novo recupera a coleta;
// - nunca é automático: só por ação do pesquisador, depois de confirmar.

/** Falhas definitivas que baixar a pesquisa de novo resolve: a coleta não é descartável. */
const RECOVERABLE_CODES = new Set(['PACKAGE_MISSING']);

export function canDiscard(collection: Pick<LocalCollection, 'status' | 'sendState'>): boolean {
    const failure = collection.sendState?.lastFailure;
    return (
        collection.status === 'FINISHED' &&
        !!failure &&
        failure.retryable === false &&
        !(failure.code && RECOVERABLE_CODES.has(failure.code))
    );
}

export class CollectionNotDiscardableError extends Error {
    constructor() {
        super('Só é possível descartar uma coleta que o servidor recusou de vez. As demais ficam na fila para serem enviadas.');
    }
}

/**
 * Apaga do aparelho a coleta (respostas, fotos e áudios). O servidor não é avisado e nada é enviado.
 * Confere de novo, no armazenamento, se ela ainda é descartável: a tela pode estar desatualizada.
 */
export async function discardCollection(clientId: string): Promise<void> {
    const collection = await getCollection(clientId);
    if (!collection) return; // já saiu do aparelho
    if (!canDiscard(collection)) throw new CollectionNotDiscardableError();

    await removeCollection(clientId);
    removeCollectionFiles(collection);
}

/**
 * Apaga um rascunho (entrevista ainda em andamento) do aparelho, com respostas, fotos e áudios.
 * Só vale para rascunho: coleta finalizada tem fila de envio e regras próprias (veja `discardCollection`).
 * Nada foi enviado ao servidor, então nada precisa ser avisado a ele.
 */
export async function discardDraft(clientId: string): Promise<void> {
    const collection = await getCollection(clientId);
    if (!collection || collection.status !== 'IN_PROGRESS') return;

    await removeCollection(clientId);
    removeCollectionFiles(collection);
}

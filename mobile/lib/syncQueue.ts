import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { sendCollection, sendCollectionFiles } from './collectionSender';
import {
    buildCollectionInput,
    getCollection,
    listSendQueue,
    markCollectionSent,
    markFileUploaded,
    recordSendFailure,
    removeCollection,
    resetCollectionSent,
} from './collectionStore';
import { releaseConfirmedFiles, removeCollectionFiles } from './confirmedFiles';
import { listUploadFiles, type CollectionInput } from './collectionUpload';
import { orderedQuestions } from './displayRules';
import { getCachedResearchPackage } from './researchCache';
import { recordSent } from './sentHistory';
import { createSyncEngine, type SendOutcome } from './syncEngine';

// A fila de envio do aparelho: o motor (syncEngine) ligado ao armazenamento local e à API.
// É um só para o app inteiro: a tela de sincronização, o envio automático e o fim da coleta usam este mesmo.
// Como vive fora das telas, o envio continua mesmo que o pesquisador saia da tela ou comece outra coleta.

/**
 * Monta o envio de uma coleta finalizada a partir do que está no aparelho. Devolve o motivo da
 * falha se não der.
 */
async function loadInput(clientId: string): Promise<{ input: CollectionInput } | { failure: SendOutcome }> {
    const collection = await getCollection(clientId);
    if (!collection || collection.status !== 'FINISHED') {
        return { failure: { kind: 'failed', reason: 'Esta coleta não está mais no aparelho.', retryable: false } };
    }

    // As regras de pulo vêm do pacote da pesquisa: questão escondida não viaja.
    // O pacote some se o pesquisador sair da conta, por isso este aviso.
    const pkg = await getCachedResearchPackage(collection.researchId);
    if (!pkg) {
        return {
            failure: {
                kind: 'failed',
                code: 'PACKAGE_MISSING',
                reason: 'A pesquisa não está mais baixada neste aparelho. Baixe-a de novo (com internet) e toque em "Tentar de novo".',
                retryable: false,
            },
        };
    }

    return { input: await buildCollectionInput(collection, orderedQuestions(pkg), pkg.displayRules) };
}

/**
 * Fila de envio de coletas do aplicativo: liga o motor de sincronização ao armazenamento local e à
 * rede.
 */
export const syncQueue = createSyncEngine({
    /** Lista as coletas aguardando envio, com a última falha de cada uma. */
    async listQueue() {
        return (await listSendQueue()).map((collection) => ({
            clientId: collection.clientId,
            lastFailure: collection.sendState?.lastFailure,
            collectionSent: collection.upload?.collectionSent === true,
        }));
    },

    /** Etapa 1: só as respostas. Os arquivos sobem depois (sendFiles), cada um por conta própria. */
    async send(clientId) {
        const loaded = await loadInput(clientId);
        if ('failure' in loaded) return loaded.failure;
        return sendCollection(loaded.input);
    },

    /**
     * Chamado quando o servidor aceita a coleta: marca como enviada e monta a lista de arquivos a
     * confirmar. Sem como montá-la, a coleta sai da fila.
     */
    async onCollectionSent(clientId) {
        await markCollectionSent(clientId);
        const loaded = await loadInput(clientId);
        // Sem como montar a lista (pacote sumiu), não há o que enviar: a coleta pode sair da fila.
        if ('failure' in loaded) return false;
        const uploaded = (await getCollection(clientId))?.upload?.uploaded ?? [];
        return listUploadFiles(loaded.input).some((file) => !uploaded.includes(file.key));
    },

    /** Etapa 2: os arquivos que o servidor ainda não tem. O que já subiu não sobe de novo. */
    async sendFiles(clientId) {
        const loaded = await loadInput(clientId);
        if ('failure' in loaded) return loaded.failure;

        const uploaded = (await getCollection(clientId))?.upload?.uploaded ?? [];
        const outcome = await sendCollectionFiles(loaded.input, uploaded, (key) => markFileUploaded(clientId, key));

        // O que o servidor confirmou e ainda ficou no aparelho (app fechado no meio, sistema que não deixou
        // apagar) sai agora: o espaço volta mesmo quando a coleta continua na fila por outro arquivo.
        const after = await getCollection(clientId);
        if (after) releaseConfirmedFiles([after]);

        // O servidor não tem a coleta: volta a mandar as respostas na próxima rodada.
        if (outcome.kind === 'failed' && outcome.code === 'COLLECTION_NOT_RECEIVED') {
            await resetCollectionSent(clientId);
        }
        return outcome;
    },

    /**
     * Chamado quando o servidor confirma tudo (inclusive os arquivos): guarda a coleta no histórico
     * de enviadas.
     */
    async onConfirmed(clientId) {
        const collection = await getCollection(clientId);
        // Fica o registro de que chegou (histórico de enviadas). Se não gravar, a coleta sai da fila do mesmo jeito.
        if (collection) {
            await recordSent({
                clientId,
                researchId: collection.researchId,
                startedAt: collection.startedAt,
                finishedAt: collection.finishedAt,
                sentAt: new Date().toISOString(),
            }).catch((error) => console.log('Falha ao registrar a coleta no histórico de enviadas:', error));
        }
        await removeCollection(clientId); // sai da fila: o servidor já tem a coleta e todos os arquivos
        // Cada arquivo foi apagado do aparelho assim que o servidor o recebeu (collectionSender); aqui sai o resto
        // (pastas vazias, arquivo que o sistema não deixou apagar na hora).
        if (collection) removeCollectionFiles(collection);
    },

    onFailed: recordSendFailure,

    /** Diz se o aparelho tem rede que alcança a internet. */
    async isOnline() {
        return isNetworkReachable(await NetInfo.fetch());
    },
});

/** Há conexão de verdade? (conectado e, quando o sistema sabe, com acesso à internet) */
export function isNetworkReachable(state: NetInfoState): boolean {
    return !!state.isConnected && state.isInternetReachable !== false;
}

/**
 * A coleta acabou de ser finalizada: se há rede, o envio começa sozinho, sem esperar o pesquisador.
 * Não bloqueia quem chama (o pesquisador já pode começar a próxima coleta).
 */
export async function requestAutoSend(): Promise<void> {
    try {
        if (isNetworkReachable(await NetInfo.fetch())) void syncQueue.run({ trigger: 'auto' });
    } catch (error) {
        console.log('Falha ao verificar a rede para enviar a coleta:', error);
    }
}

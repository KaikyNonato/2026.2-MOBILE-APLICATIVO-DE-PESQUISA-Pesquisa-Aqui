import { useCallback } from 'react';
import { Alert } from 'react-native';
import {
    describePending,
    getPendingCollections,
    PendingCollectionsError,
    returnResearchSafely,
} from '@/lib/researchReturn';

/**
 * Remover a pesquisa do aparelho (mesmo fluxo na lista de pesquisas e no histórico de envio):
 * 1. bloqueia enquanto houver coleta pendente (nada de apagar trabalho que não chegou ao servidor);
 * 2. pede confirmação, explicando que os dados locais serão apagados;
 * 3. avisa o servidor: a cópia deixa de contar como ativa e o questionário caminha para destravar;
 * 4. a pesquisa volta à lista como "Não baixada" (`onRemoved` recarrega a tela).
 */
export function useRemoveResearch(isOnline: boolean, onRemoved: () => void | Promise<void>) {
    return useCallback(
        async (id: number, title: string) => {
            const pending = await getPendingCollections(id);
            if (pending.finished + pending.drafts > 0) {
                Alert.alert(
                    'Remoção bloqueada',
                    `"${title}" ainda tem ${describePending(pending)} neste aparelho. ` +
                    'Envie tudo (ou conclua os rascunhos e envie) antes de remover a pesquisa. ' +
                    'Assim nenhuma coleta é perdida. ' +
                    'Coleta que o servidor recusou de vez pode ser descartada na aba Falhas do histórico de envio.',
                );
                return;
            }

            if (!isOnline) {
                Alert.alert('Sem conexão', 'Conecte-se à internet para remover esta pesquisa: o servidor precisa ser avisado.');
                return;
            }

            Alert.alert(
                'Remover pesquisa do aparelho?',
                `Os dados locais de "${title}" serão apagados deste aparelho: o questionário baixado deixa de existir aqui. ` +
                'O servidor será avisado e esta cópia deixa de contar como ativa, o que ajuda a liberar o questionário para o administrador. ' +
                'As coletas já enviadas continuam salvas no servidor. Para coletar de novo, será preciso baixar a pesquisa outra vez.',
                [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                        text: 'Remover',
                        style: 'destructive',
                        onPress: async () => {
                            try {
                                await returnResearchSafely(id);
                                await onRemoved();
                            } catch (error) {
                                Alert.alert(
                                    error instanceof PendingCollectionsError ? 'Remoção bloqueada' : 'Não foi possível remover',
                                    error instanceof Error ? error.message : 'Tente de novo.',
                                );
                            }
                        },
                    },
                ],
            );
        },
        [isOnline, onRemoved],
    );
}

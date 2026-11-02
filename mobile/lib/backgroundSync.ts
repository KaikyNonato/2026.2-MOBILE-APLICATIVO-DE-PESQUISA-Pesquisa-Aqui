import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { isLoggedIn } from './auth';
import { reconcileNotifications } from './notifications';
import { syncResearches } from './researchCache';
import { syncQueue } from './syncQueue';

// Sincronização em segundo plano: com o app fechado, o sistema acorda o aplicativo de tempos em tempos
// (e só quando há rede) para enviar a fila de coletas, atualizar a lista de pesquisas e dar os avisos.
// O sistema decide o horário: no Android o intervalo mínimo é de 15 minutos e pode demorar mais com a bateria
// fraca ou o app muito tempo sem uso; no iOS é ainda mais irregular. Com o app aberto, o envio automático
// (useAutoSync) continua cuidando da fila na hora em que a rede volta.

export const BACKGROUND_SYNC_TASK = 'pesquisa-aqui-background-sync';

/** Uma rodada completa, a mesma para o segundo plano e para quem abre o app: envia, atualiza a lista e avisa. */
export async function syncAndNotify(): Promise<void> {
    await syncQueue.run({ trigger: 'auto' });
    await syncResearches();
    await reconcileNotifications();
}

// A tarefa precisa ser definida no escopo do módulo, antes de qualquer tela (por isso é importada no layout raiz).
if (Platform.OS !== 'web') {
    TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
        try {
            // Sem sessão (saiu da conta) não há o que sincronizar
            if (!(await isLoggedIn())) return BackgroundTask.BackgroundTaskResult.Success;
            await syncAndNotify();
            return BackgroundTask.BackgroundTaskResult.Success;
        } catch (error) {
            console.log('Sincronização em segundo plano falhou:', error);
            return BackgroundTask.BackgroundTaskResult.Failed;
        }
    });
}

/** Liga a tarefa periódica (a cada 15 min no mínimo). Seguro chamar de novo: não duplica. */
export async function registerBackgroundSync(): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
        const status = await BackgroundTask.getStatusAsync();
        if (status !== BackgroundTask.BackgroundTaskStatus.Available) return; // o sistema não permite (ex.: economia de bateria extrema)
        if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) return;
        await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, { minimumInterval: 15 });
    } catch (error) {
        console.log('Não foi possível ligar a sincronização em segundo plano:', error);
    }
}

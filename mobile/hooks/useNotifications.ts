import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { registerBackgroundSync, syncAndNotify } from '@/lib/backgroundSync';
import { askPermissionOnce, configureNotifications, reconcileNotifications } from '@/lib/notifications';
import { syncQueue } from '@/lib/syncQueue';

/** Intervalo mínimo entre duas rodadas completas disparadas por "o app voltou para a frente". */
const MIN_GAP_MS = 30_000;
/** De quanto em quanto tempo, com o app aberto, a lista de pesquisas é atualizada para achar pesquisa nova ou encerrada. */
const FOREGROUND_REFRESH_MS = 60_000;
/** Espera depois de uma mudança na fila de envio antes de reconferir a meta (evita reconferir a cada coleta enviada). */
const QUEUE_DEBOUNCE_MS = 2_000;

/**
 * Avisos e sincronização em segundo plano. Fica no layout do app logado:
 * - prepara as notificações e pergunta a permissão na primeira vez;
 * - a cada abertura/volta ao app: envia a fila, atualiza as pesquisas e confere o que merece aviso;
 * - quando a fila de envio muda (coleta enviada), reconfere a meta: bater a meta cancela o aviso de prazo;
 * - ao tocar num aviso, abre a lista de pesquisas;
 * - liga a tarefa que o sistema roda com o app fechado.
 */
export function useNotificationsAndBackgroundSync(): void {
    useEffect(() => {
        if (Platform.OS === 'web') return;
        let lastRun = 0;
        let debounce: ReturnType<typeof setTimeout> | undefined;

        const runRound = () => {
            if (Date.now() - lastRun < MIN_GAP_MS) return;
            lastRun = Date.now();
            void syncAndNotify().catch((error) => console.log('Rodada de sincronização falhou:', error));
        };

        // Nenhum passo pode derrubar o app: em Expo Go, por exemplo, notificações e tarefas de fundo são limitadas.
        void (async () => {
            try {
                await configureNotifications();
                await askPermissionOnce();
            } catch (error) {
                console.log('Notificações indisponíveis:', error);
            }
            runRound();
            await registerBackgroundSync();
        })();

        const appState = AppState.addEventListener('change', (status) => {
            if (status === 'active') runRound();
        });

        // Com o app aberto o aviso também precisa chegar: sem isto, só apareceria depois de sair e voltar ao app.
        const refreshTimer = setInterval(() => {
            if (AppState.currentState === 'active') runRound();
        }, FOREGROUND_REFRESH_MS);

        const unsubscribeQueue = syncQueue.subscribe(() => {
            clearTimeout(debounce);
            debounce = setTimeout(() => void reconcileNotifications(), QUEUE_DEBOUNCE_MS);
        });

        let responseSubscription: { remove: () => void } | undefined;
        try {
            responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
                if (response.notification.request.content.data?.screen === 'pesquisas') router.push('/(app)/pesquisas');
            });
        } catch (error) {
            console.log('Toque em aviso indisponível:', error);
        }

        return () => {
            appState.remove();
            clearInterval(refreshTimer);
            unsubscribeQueue();
            responseSubscription?.remove();
            clearTimeout(debounce);
        };
    }, []);
}

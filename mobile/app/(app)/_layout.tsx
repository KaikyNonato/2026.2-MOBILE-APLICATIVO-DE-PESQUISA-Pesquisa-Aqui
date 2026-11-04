import { CustomTabBar } from '@/components/CustomTabBar';
import { Tabs } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider } from '@/context/AuthContext';
import { LowSpaceBanner } from '@/components/LowSpaceBanner';
import { OfflineBanner } from '@/components/OfflineBanner';
import { useAutoSync } from '@/hooks/useSyncQueue';
import { useNotificationsAndBackgroundSync } from '@/hooks/useNotifications';
import { Brand } from '@/constants/brand';
import { t } from '@/i18n';

/** Layout das abas do app: liga o envio automático de coletas, as notificações e a barra de abas. */
export default function TabLayout() {
    // Envia a fila de coletas sozinho quando há rede, em qualquer tela do app
    useAutoSync();
    // Avisos (pesquisa nova, meta perto do prazo, pesquisa encerrada) e sincronização com o app fechado
    useNotificationsAndBackgroundSync();

    return (
        <AuthProvider>
            <SafeAreaProvider>
                {/* cor da área sob a câmera do celular */}
                <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: Brand.forest }}>
                    <OfflineBanner />
                    <LowSpaceBanner />
                    <Tabs
                        tabBar={(props: any) => <CustomTabBar {...props} />}
                        screenOptions={{ sceneStyle: { backgroundColor: Brand.paper } }}
                    >
                        <Tabs.Screen
                            name="(home)/index"
                            options={{ title: t('tabs.home'), headerShown: false }}
                        />

                        <Tabs.Screen
                            name="pesquisas/index"
                            options={{ title: t('tabs.surveys'), headerShown: false }}
                        />

                        <Tabs.Screen
                            name="sincronizacao/index"
                            options={{ title: t('tabs.sync'), headerShown: false }}
                        />

                        <Tabs.Screen
                            name="usuario/index"
                            options={{ title: t('tabs.profile'), headerShown: false }}
                        />
                    </Tabs>
                </SafeAreaView>
            </SafeAreaProvider>
        </AuthProvider>
    );
}

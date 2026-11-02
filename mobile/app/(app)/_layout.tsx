import { CustomTabBar } from '@/components/CustomTabBar';
import { Tabs } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider } from '@/context/AuthContext';
import { LowSpaceBanner } from '@/components/LowSpaceBanner';
import { OfflineBanner } from '@/components/OfflineBanner';
import { useAutoSync } from '@/hooks/useSyncQueue';
import { useNotificationsAndBackgroundSync } from '@/hooks/useNotifications';
import { Brand } from '@/constants/brand';

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
                            options={{ title: 'Home', headerShown: false }}
                        />

                        <Tabs.Screen
                            name="pesquisas/index"
                            options={{ title: 'Pesquisas', headerShown: false }}
                        />

                        <Tabs.Screen
                            name="sincronizacao/index"
                            options={{ title: 'Sinc', headerShown: false }}
                        />

                        <Tabs.Screen
                            name="usuario/index"
                            options={{ title: 'Perfil', headerShown: false }}
                        />
                    </Tabs>
                </SafeAreaView>
            </SafeAreaProvider>
        </AuthProvider>
    );
}
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { syncResearches } from '@/lib/researchCache';
import BrandMark from '@/components/BrandMark';
import Contour from '@/components/Contour';
import { Brand } from '@/constants/brand';

/** Tela inicial: espera a sessão carregar e leva para o login ou para o app. */
export default function Splash() {
    const router = useRouter();
    const { isAuthenticated, isLoading } = useAuth();
    const isOnline = useNetworkStatus();
    const [statusText, setStatusText] = useState('Iniciando...');

    useEffect(() => {
        if (isLoading) return;

        const run = async () => {
            if (isAuthenticated) {
                if (isOnline) {
                    setStatusText('Atualizando dados...');
                    try {
                        await syncResearches();
                    } catch (error) {
                        console.log('Falha na sincronização inicial, seguindo offline.', error);
                    }
                } else {
                    setStatusText('Sem conexão — usando dados salvos');
                }
                router.replace('/(app)/(home)');
            } else {
                router.replace('/login');
            }
        };

        run();
    }, [isLoading, isAuthenticated, isOnline]);

    return (
        <View style={styles.container}>
            <StatusBar style="light" />
            <Contour seed={1.2} rings={13} cx={0.5} cy={0.5} size={1.1} width={390} height={844} opacity={0.8} />
            <View style={styles.center}>
                <BrandMark size={44} color={Brand.mint} />
                <Text style={styles.name}>Pesquisa Aqui</Text>
                <ActivityIndicator size="small" color={Brand.mint} style={styles.spinner} />
                <Text style={styles.text}>{statusText}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Brand.forest },
    center: { alignItems: 'center', gap: 10 },
    name: { color: '#fff', fontSize: 24, fontWeight: '600', letterSpacing: -0.5 },
    spinner: { marginTop: 14 },
    text: { fontSize: 14, color: Brand.mutedDark },
});

import { View, Text, StyleSheet } from 'react-native';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { WifiOff } from 'lucide-react-native';
import { Brand } from '@/constants/brand';

/** Aviso exibido quando o aparelho está sem internet. */
export function OfflineBanner() {
    const isOnline = useNetworkStatus();

    if (isOnline) return null;

    return (
        <View style={styles.banner} accessibilityRole="alert">
            <WifiOff size={16} color={Brand.warn} />
            <Text style={styles.text}>Você está offline. Exibindo dados locais.</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    banner: {
        flexDirection: 'row',
        backgroundColor: Brand.warnLight,
        paddingVertical: 8,
        paddingHorizontal: 16,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    text: {
        color: Brand.warn,
        fontSize: 13,
        fontWeight: '500',
    },
});

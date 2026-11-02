import { Fingerprint, LogOut } from 'lucide-react-native';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import BrandMark from '@/components/BrandMark';
import { Brand } from '@/constants/brand';
import { useAuth } from '@/context/AuthContext';
import { useBiometricLock } from '@/context/BiometricLockContext';

/** Tela de bloqueio por cima de todo o app. Só aparece com a biometria ligada e a sessão aberta. */
export default function BiometricGate() {
    const { isAuthenticated, logout } = useAuth();
    const { locked, unlock } = useBiometricLock();
    const visible = locked && isAuthenticated;

    // Já pede a biometria ao bloquear, sem esperar o toque.
    useEffect(() => {
        if (visible) void unlock();
    }, [visible, unlock]);

    if (!visible) return null;

    return (
        <View style={styles.overlay} accessibilityViewIsModal importantForAccessibility="yes">
            <View style={styles.center}>
                <BrandMark size={52} color={Brand.mint} />
                <Text style={styles.title} accessibilityRole="header">Aplicativo bloqueado</Text>
                <Text style={styles.text}>Confirme sua identidade para continuar de onde parou.</Text>

                <Pressable
                    onPress={() => void unlock()}
                    style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Desbloquear com biometria"
                >
                    <Fingerprint size={20} color={Brand.forest} strokeWidth={1.9} />
                    <Text style={styles.primaryText}>Desbloquear</Text>
                </Pressable>
            </View>

            <Pressable
                onPress={() => void logout()}
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Sair da conta"
            >
                <LogOut size={16} color={Brand.mutedDark} strokeWidth={1.8} />
                <Text style={styles.secondaryText}>Entrar com outra conta</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        backgroundColor: Brand.forest,
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 28,
        paddingTop: 96,
        paddingBottom: 48,
    },
    center: { alignItems: 'center', gap: 14 },
    title: { color: Brand.fgDark, fontSize: 26, fontWeight: '600', letterSpacing: -0.6, marginTop: 18 },
    text: { color: Brand.mutedDark, fontSize: 15, textAlign: 'center', lineHeight: 22, maxWidth: 300 },
    primary: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        minWidth: 220,
        height: 52,
        borderRadius: 999,
        backgroundColor: Brand.mint,
        marginTop: 18,
    },
    primaryText: { color: Brand.forest, fontSize: 16, fontWeight: '600' },
    secondary: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 16 },
    secondaryText: { color: Brand.mutedDark, fontSize: 14.5 },
    pressed: { opacity: 0.7 },
});

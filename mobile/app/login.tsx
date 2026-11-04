import { useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { WifiOff } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import BrandMark from '@/components/BrandMark';
import Contour from '@/components/Contour';
import { Brand, Radius } from '@/constants/brand';

/** Tela de login do pesquisador. */
export default function Login() {
    const router = useRouter();
    const { login } = useAuth();
    const isOnline = useNetworkStatus();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [focused, setFocused] = useState<'username' | 'password' | null>(null);

    const handleLogin = async () => {
        setError(null);
        setLoading(true);
        try {
            const { mustChangePassword } = await login(username, password);
            // Senha temporária (primeiro acesso ou redefinida pelo administrador): troca antes de usar o app.
            router.replace(mustChangePassword ? '/trocar-senha' : '/(app)/(home)');
        } catch (err: any) {
            setError(err.message || 'Erro ao fazer login.');
        } finally {
            setLoading(false);
        }
    };

    const disabled = loading || !isOnline;

    return (
        <SafeAreaView style={styles.safe}>
            <StatusBar style="light" />
            <Contour seed={2.4} rings={14} cx={0.7} cy={0.3} size={1.1} width={390} height={844} opacity={0.9} />
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <ScrollView
                    contentContainerStyle={styles.scroll}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.brandRow}>
                        <BrandMark color={Brand.mint} />
                        <Text style={styles.brandName}>Pesquisa Aqui</Text>
                    </View>

                    <View style={styles.copy}>
                        <Text style={styles.headline}>Cada resposta no lugar certo.</Text>
                        <Text style={styles.lead}>Entre para ver suas pesquisas e registrar as coletas em campo.</Text>
                    </View>

                    <View style={styles.card}>
                        <Text style={styles.title}>Entrar</Text>
                        <Text style={styles.sub}>Use o usuário e a senha fornecidos pela sua empresa.</Text>

                        {!isOnline && (
                            <View style={styles.offline} accessibilityRole="alert">
                                <WifiOff size={16} color={Brand.warn} />
                                <Text style={styles.offlineText}>
                                    Você está offline. É preciso internet para entrar pela primeira vez.
                                </Text>
                            </View>
                        )}

                        <Text style={styles.label}>Usuário</Text>
                        <TextInput
                            style={[styles.input, focused === 'username' && styles.inputFocused]}
                            placeholder="nome.sobrenome"
                            placeholderTextColor="#94a39a"
                            value={username}
                            onChangeText={setUsername}
                            onFocus={() => setFocused('username')}
                            onBlur={() => setFocused(null)}
                            autoCapitalize="none"
                            autoCorrect={false}
                            textContentType="username"
                            accessibilityLabel="Usuário"
                        />

                        <Text style={styles.label}>Senha</Text>
                        <TextInput
                            style={[styles.input, focused === 'password' && styles.inputFocused]}
                            placeholder="••••••••"
                            placeholderTextColor="#94a39a"
                            value={password}
                            onChangeText={setPassword}
                            onFocus={() => setFocused('password')}
                            onBlur={() => setFocused(null)}
                            secureTextEntry
                            textContentType="password"
                            accessibilityLabel="Senha"
                        />

                        {error && (
                            <Text style={styles.error} accessibilityRole="alert">
                                {error}
                            </Text>
                        )}

                        <TouchableOpacity
                            style={[styles.button, disabled && styles.buttonDisabled]}
                            onPress={handleLogin}
                            disabled={disabled}
                            accessibilityRole="button"
                            accessibilityLabel="Entrar"
                        >
                            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Entrar</Text>}
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: Brand.forest },
    flex: { flex: 1 },
    scroll: { flexGrow: 1, justifyContent: 'space-between', padding: 22, gap: 28 },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
    brandName: { color: Brand.fgDark, fontSize: 16, fontWeight: '600' },
    copy: { gap: 14 },
    headline: { color: '#fff', fontSize: 44, lineHeight: 46, fontWeight: '600', letterSpacing: -2, maxWidth: 320 },
    lead: { color: Brand.mutedDark, fontSize: 15, lineHeight: 22, maxWidth: 320 },
    card: { backgroundColor: '#fff', borderRadius: 28, padding: 24, gap: 6 },
    title: { fontSize: 26, fontWeight: '600', letterSpacing: -0.6, color: Brand.ink },
    sub: { color: Brand.muted, fontSize: 14, marginBottom: 14, lineHeight: 20 },
    label: { fontSize: 13, fontWeight: '500', color: Brand.ink, marginTop: 8, marginBottom: 4 },
    input: {
        minHeight: 48,
        borderWidth: 1,
        borderColor: '#d3dad5',
        borderRadius: Radius.input,
        paddingHorizontal: 14,
        fontSize: 16,
        color: Brand.ink,
        backgroundColor: '#fff',
    },
    inputFocused: { borderColor: Brand.green, borderWidth: 2 },
    button: {
        minHeight: 52,
        borderRadius: Radius.pill,
        backgroundColor: Brand.ink,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 18,
    },
    buttonDisabled: { opacity: 0.45 },
    buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
    error: {
        marginTop: 12,
        backgroundColor: Brand.clayLight,
        color: Brand.clayInk,
        fontSize: 13,
        fontWeight: '500',
        padding: 12,
        borderRadius: 12,
        overflow: 'hidden',
    },
    offline: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: Brand.warnLight,
        padding: 12,
        borderRadius: 12,
        marginBottom: 6,
    },
    offlineText: { flex: 1, color: Brand.warn, fontSize: 13 },
});

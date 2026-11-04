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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { changePassword, passwordProblem } from '@/lib/auth';
import BrandMark from '@/components/BrandMark';
import Contour from '@/components/Contour';
import { Brand, Radius } from '@/constants/brand';

/**
 * Aberta depois do login quando a senha é temporária (cadastro novo ou redefinição feita pelo
 * administrador).
 * Enquanto a senha não for trocada, a API recusa todo o resto (ver AuthGuard).
 */
export default function TrocarSenha() {
    const router = useRouter();
    const { logout, refreshUser } = useAuth();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSave = async () => {
        setError(null);

        const problem = passwordProblem(newPassword);

        if (!currentPassword) return setError('Informe a senha temporária que você recebeu.');
        if (problem) return setError(problem);
        if (newPassword !== confirmation) return setError('A confirmação não é igual à nova senha.');
        if (newPassword === currentPassword) return setError('A nova senha precisa ser diferente da temporária.');

        setLoading(true);
        try {
            await changePassword(currentPassword, newPassword);
            await refreshUser();
            router.replace('/(app)/(home)');
        } catch (err: any) {
            setError(err.message || 'Não foi possível trocar a senha.');
        } finally {
            setLoading(false);
        }
    };

    const handleLeave = async () => {
        await logout();
        router.replace('/login');
    };

    return (
        <SafeAreaView style={styles.safe}>
            <StatusBar style="light" />
            <Contour seed={2.4} rings={14} cx={0.7} cy={0.3} size={1.1} width={390} height={844} opacity={0.9} />
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                    <View style={styles.brandRow}>
                        <BrandMark color={Brand.mint} />
                        <Text style={styles.brandName}>Pesquisa Aqui</Text>
                    </View>

                    <View style={styles.copy}>
                        <Text style={styles.headline}>Escolha a sua senha.</Text>
                        <Text style={styles.lead}>A senha que você recebeu é temporária. Defina uma só sua para continuar.</Text>
                    </View>

                    <View style={styles.card}>
                        <Text style={styles.title}>Trocar senha</Text>
                        <Text style={styles.sub}>A senha deve ter de 8 a 64 caracteres, com pelo menos uma letra e um número.</Text>

                        <Text style={styles.label}>Senha temporária</Text>
                        <TextInput style={styles.input} secureTextEntry autoCapitalize="none" autoCorrect={false} value={currentPassword} onChangeText={setCurrentPassword} />

                        <Text style={styles.label}>Nova senha</Text>
                        <TextInput style={styles.input} secureTextEntry autoCapitalize="none" autoCorrect={false} value={newPassword} onChangeText={setNewPassword} />

                        <Text style={styles.label}>Repita a nova senha</Text>
                        <TextInput style={styles.input} secureTextEntry autoCapitalize="none" autoCorrect={false} value={confirmation} onChangeText={setConfirmation} onSubmitEditing={handleSave} />

                        {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}

                        <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleSave} disabled={loading} accessibilityRole="button">
                            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Salvar e entrar</Text>}
                        </TouchableOpacity>

                        <TouchableOpacity onPress={handleLeave} style={styles.leave} accessibilityRole="button">
                            <Text style={styles.leaveText}>Sair</Text>
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
    headline: { color: '#fff', fontSize: 40, lineHeight: 42, fontWeight: '600', letterSpacing: -2, maxWidth: 320 },
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
    button: { minHeight: 52, borderRadius: Radius.pill, backgroundColor: Brand.ink, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
    buttonDisabled: { opacity: 0.45 },
    buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
    error: { marginTop: 12, backgroundColor: Brand.clayLight, color: Brand.clayInk, fontSize: 13, fontWeight: '500', padding: 12, borderRadius: 12, overflow: 'hidden' },
    leave: { alignItems: 'center', paddingVertical: 14 },
    leaveText: { color: Brand.muted, fontSize: 14, fontWeight: '500' },
});

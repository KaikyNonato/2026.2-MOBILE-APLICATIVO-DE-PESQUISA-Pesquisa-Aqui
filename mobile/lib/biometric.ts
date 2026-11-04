import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

// Desbloqueio por biometria (digital, Face ID...). O login continua sendo usuário e senha; depois de entrar, o app
// guarda a sessão no aparelho (SecureStore) e, com a biometria ligada, só abre depois de confirmar quem está com o celular.
// Nenhuma senha é guardada para isso: a biometria só libera a sessão que já estava no aparelho.

const ENABLED_KEY = 'biometric_enabled';

/** O aparelho tem sensor e ao menos uma biometria cadastrada? */
export async function isBiometricAvailable(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    try {
        const [hardware, enrolled] = await Promise.all([
            LocalAuthentication.hasHardwareAsync(),
            LocalAuthentication.isEnrolledAsync(),
        ]);
        return hardware && enrolled;
    } catch {
        return false;
    }
}

/** Diz se o usuário ligou o bloqueio por biometria (sempre `false` na web). */
export async function isBiometricEnabled(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    try {
        return (await SecureStore.getItemAsync(ENABLED_KEY)) === '1';
    } catch {
        return false;
    }
}

/** Liga ou desliga o bloqueio por biometria. */
export async function setBiometricEnabled(enabled: boolean): Promise<void> {
    if (Platform.OS === 'web') return;
    if (enabled) await SecureStore.setItemAsync(ENABLED_KEY, '1');
    else await SecureStore.deleteItemAsync(ENABLED_KEY);
}

/** Pede a biometria (com o PIN/padrão do aparelho como alternativa). Devolve se a pessoa foi confirmada. */
export async function authenticateWithBiometrics(promptMessage: string): Promise<boolean> {
    try {
        const result = await LocalAuthentication.authenticateAsync({
            promptMessage,
            cancelLabel: 'Cancelar',
            fallbackLabel: 'Usar senha do aparelho',
        });
        return result.success;
    } catch {
        return false;
    }
}

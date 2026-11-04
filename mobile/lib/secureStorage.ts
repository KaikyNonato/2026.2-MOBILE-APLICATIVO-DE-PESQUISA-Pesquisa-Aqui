import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'access_token';

/** Guarda o token de acesso (no armazenamento seguro; na web, em localStorage). */
export async function saveToken(token: string): Promise<void> {
    if (Platform.OS === 'web') {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(TOKEN_KEY, token);
        }
        return;
    }
    await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/** Lê o token de acesso guardado (`null` se não houver). */
export async function getToken(): Promise<string | null> {
    if (Platform.OS === 'web') {
        if (typeof window !== 'undefined') {
            return window.localStorage.getItem(TOKEN_KEY);
        }
        return null;
    }
    return SecureStore.getItemAsync(TOKEN_KEY);
}

/** Apaga o token de acesso guardado. */
export async function clearToken(): Promise<void> {
    if (Platform.OS === 'web') {
        if (typeof window !== 'undefined') {
            window.localStorage.removeItem(TOKEN_KEY);
        }
        return;
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
}

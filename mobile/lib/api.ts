import { router } from "expo-router";
import { clearToken, getToken } from "./secureStorage";

const rawBaseUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

/** Remove espaços, aspas acidentais e barras no final */
export const API_BASE_URL = rawBaseUrl.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');

/** Erro de resposta da API, com o status HTTP. */
export class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

/** Chama a API com o token do usuário, garantindo que o caminho comece com uma barra. */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const token = await getToken();

    // Garante que o path comece com uma barra única e sem espaços
    const cleanPath = path.trim().startsWith('/') ? path.trim() : `/${path.trim()}`;
    const url = `${API_BASE_URL}${cleanPath}`;

    // Em upload (FormData) o Content-Type com o boundary é definido pelo próprio fetch.
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

    const response = await fetch(url, {
        ...options,
        headers: {
            ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...options.headers,
        },
    });

    if (response.status === 401) {
        await clearToken();
        router.replace('/login');
        throw new ApiError('Session expired', 401);
    }

    // Senha temporária: o app fica bloqueado até a pessoa definir a própria senha.
    if (response.status === 403 && !path.includes('/auth/')) {
        const body = await response.clone().json().catch(() => null);

        if (body?.code === 'PASSWORD_CHANGE_REQUIRED') {
            router.replace('/trocar-senha');
            throw new ApiError('Password change required', 403);
        }
    }

    return response;
}

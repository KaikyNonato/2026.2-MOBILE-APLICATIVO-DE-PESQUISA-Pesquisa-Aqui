import { logout } from "./auth";

// Caminho do próprio painel: o next.config.ts repassa /api/* para a API (variável API_URL).
const API_BASE_URL = "/api";

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
    // Upload (FormData): o navegador monta o Content-Type com o separador do multipart; fixar JSON quebraria o envio.
    const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;

    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        credentials: 'include',
        headers: {
            ...(isForm ? {} : { 'Content-Type': 'application/json' }),
            ...options.headers,
        },
    });

    if (response.status === 401) {
        await logout();
        throw new Error('Session expired');
    }

    // Senha temporária: o painel inteiro fica bloqueado até a pessoa definir a própria senha.
    if (response.status === 403 && typeof window !== 'undefined' && window.location.pathname !== '/trocar-senha') {
        const body = await response.clone().json().catch(() => null);

        if (body?.code === 'PASSWORD_CHANGE_REQUIRED') {
            window.location.replace('/trocar-senha');
            throw new Error('Password change required');
        }
    }

    return response;
}

export function isSessionExpiredError(error: unknown): boolean {
    return error instanceof Error && error.message === 'Session expired';
}
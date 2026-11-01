import { apiFetch } from "./apiFetcher";

export interface AuthUser {
    sub: string;
    name: string;
    profile: 'SUPERADMINISTRATOR' | 'ADMINISTRATOR' | 'RESEARCHER';
    companyId: number;
    /** Foto de perfil (endereço no Cloudinary). Nulo = sem foto. */
    avatarUrl?: string | null;
    /** Senha temporária: a pessoa precisa trocá-la antes de usar o painel. */
    mustChangePassword?: boolean;
}

/** Disparado quando o usuário altera o próprio perfil: quem mostra o nome dele (menu lateral) busca de novo. */
export const USER_UPDATED_EVENT = 'pa:user-updated';

export const notifyUserUpdated = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(USER_UPDATED_EVENT));
};

/** Mensagens da API de login convertidas para o texto mostrado na tela. */
export class LoginError extends Error {
    constructor(message: string, readonly locked = false) {
        super(message);
    }
}

export const login = async (username: string, password: string): Promise<{ mustChangePassword: boolean }> => {
    const response = await apiFetch(`/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
    })

    if (response.status === 429) {
        const body = await response.json().catch(() => null);
        const message = body?.code === 'ACCOUNT_LOCKED' && typeof body.message === 'string'
            ? body.message
            : 'Muitas tentativas de login. Aguarde um pouco e tente novamente.';

        throw new LoginError(message, true);
    }

    if (!response.ok) throw new LoginError('Nome de usuário ou senha incorretos, ou empresa inativa.');

    const body = await response.json();

    return { mustChangePassword: body?.mustChangePassword === true };
}

export const PASSWORD_RULES = 'A senha deve ter de 8 a 64 caracteres, com pelo menos uma letra e um número.';

/** Mesma regra da API (ver api/src/auth/password-policy.ts). Devolve o problema ou `null`. */
export const passwordProblem = (password: string): string | null =>
    password.length >= 8 && password.length <= 64 && /\p{L}/u.test(password) && /\d/.test(password) ? null : PASSWORD_RULES;

export const changePassword = async (currentPassword: string, newPassword: string) => {
    const response = await apiFetch(`/auth/change-password`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
    });

    if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
        const known: Record<string, string> = {
            'Current password is incorrect': 'A senha atual está incorreta.',
            'The new password must be different from the current one': 'A nova senha precisa ser diferente da atual.',
        };

        throw new Error(known[message] ?? (response.status === 400 ? PASSWORD_RULES : 'Não foi possível trocar a senha.'));
    }
}

export const logout = async () => {
    try {
        await apiFetch(`/auth/logout`, {
            method: 'POST',
            credentials: 'include',
        });
    } catch (error) {
        console.log('Failed to notify backend about logout', error);
    }

    window.location.href = '/login';
}

export const getCurrentUser = async (): Promise<AuthUser | null> => {
    try {
        const response = await apiFetch(`/auth/me`, {
            method: 'GET',
            credentials: 'include',
        });

        if (response.status === 401) {
            await logout();
            return null;
        }

        if (!response.ok) {
            console.error('getCurrentUser failed:', response.status, await response.text());
            return null;
        }

        return response.json();
    } catch (error) {
        console.error('Failed to apiFetch current user:', error);
        return null;
    }
};
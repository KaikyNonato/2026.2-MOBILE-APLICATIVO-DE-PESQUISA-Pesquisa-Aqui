import { API_BASE_URL, apiFetch } from './api';
import { saveToken, getToken, clearToken } from './secureStorage';
import { clearResearchesCache } from './researchCache';
import { returnAllCopies } from './researchReturn';
import { filePart } from './collectionUpload';
import { setBiometricEnabled } from './biometric';

export interface CurrentUser {
    sub: string;
    name: string;
    profile: 'SUPERADMINISTRATOR' | 'ADMINISTRATOR' | 'RESEARCHER';
    companyId: number | null;
    companyName: string | null;
    /** Foto de perfil (endereço no Cloudinary); nulo = sem foto. */
    avatarUrl?: string | null;
    /** Logo da empresa (endereço no Cloudinary); nulo = sem logo. */
    companyLogoUrl?: string | null;
    /** Senha temporária: precisa ser trocada antes de usar o aplicativo. */
    mustChangePassword?: boolean;
}

/** Entra e devolve se a senha é temporária (nesse caso o app abre a tela de troca de senha). */
export async function login(username: string, password: string): Promise<{ mustChangePassword: boolean }> {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username,
            password,
            platform: 'mobile'
        }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        throw new Error(errorData.message || 'Usuário ou senha inválidos.');
    }

    const data = await response.json();

    if (!data.access_token) {
        throw new Error('Não foi possível concluir o login.');
    }

    await saveToken(data.access_token);

    return { mustChangePassword: data.mustChangePassword === true };
}

const PASSWORD_RULES = 'A senha deve ter de 8 a 64 caracteres, com pelo menos uma letra e um número.';

/** Mesma regra da API (api/src/auth/password-policy.ts). Devolve o problema ou `null`. */
export function passwordProblem(password: string): string | null {
    return password.length >= 8 && password.length <= 64 && /\p{L}/u.test(password) && /\d/.test(password) ? null : PASSWORD_RULES;
}

/** Troca a senha do usuário logado. A API devolve um token novo (o antigo deixa de valer com a senha nova). */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const response = await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = Array.isArray(data?.message) ? data.message[0] : data?.message;
        const known: Record<string, string> = {
            'Current password is incorrect': 'A senha atual está incorreta.',
            'The new password must be different from the current one': 'A nova senha precisa ser diferente da atual.',
        };

        throw new Error(known[message] ?? (response.status === 400 ? PASSWORD_RULES : 'Não foi possível trocar a senha. Tente novamente.'));
    }

    const data = await response.json();

    if (data.access_token) await saveToken(data.access_token);
}

export async function isLoggedIn(): Promise<boolean> {
    const token = await getToken();
    return !!token;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
    try {
        const response = await apiFetch('/auth/me');
        if (!response.ok) return null;
        return response.json();
    } catch {
        return null;
    }
}

export async function logout(): Promise<void> {
    // Antes de apagar o token (a API precisa dele): devolve as cópias, para o contador de cópias do servidor cair.
    await returnAllCopies().catch(() => undefined);
    await clearToken();
    // A biometria é de quem estava logado: a próxima pessoa que entrar escolhe a dela.
    await setBiometricEnabled(false).catch(() => undefined);
    await clearResearchesCache();
}

async function readError(response: Response, fallback: string): Promise<string> {
    const data = await response.json().catch(() => ({}));
    const message = Array.isArray(data?.message) ? data.message[0] : data?.message;
    return typeof message === 'string' && message ? message : fallback;
}

/** Envia a foto de perfil (JPEG já reduzido, no aparelho). A API troca a foto do próprio usuário logado. */
export async function uploadAvatar(uri: string): Promise<void> {
    const form = new FormData();
    form.append('file', filePart(uri, 'avatar.jpg', 'image/jpeg'));

    const response = await apiFetch('/auth/avatar', { method: 'POST', body: form });

    if (!response.ok) throw new Error(await readError(response, 'Não foi possível enviar a foto. Tente novamente.'));
}

/** Remove a foto de perfil: o app volta a mostrar as iniciais. */
export async function removeAvatar(): Promise<void> {
    const response = await apiFetch('/auth/avatar', { method: 'DELETE' });

    if (!response.ok) throw new Error(await readError(response, 'Não foi possível remover a foto. Tente novamente.'));
}

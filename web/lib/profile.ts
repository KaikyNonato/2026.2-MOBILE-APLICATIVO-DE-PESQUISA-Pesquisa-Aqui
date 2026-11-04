import { apiFetch } from "./apiFetcher";
import { notifyUserUpdated } from "./auth";
import type { UserItem } from "./user";

/** Perfil do usuário logado (GET /auth/profile). */
export type ProfileData = UserItem & { companyName: string | null; companyLogoUrl?: string | null; avatarUrl: string | null };

/** Foto de perfil: tipos e tamanho aceitos (o servidor confere de novo). */
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export interface UpdateProfileInput {
    name?: string;
    username?: string;
    /** Obrigatória quando a senha é trocada. */
    currentPassword?: string;
    newPassword?: string;
}

const PROFILE_ERRORS: Record<string, string> = {
    'Username already exists': 'Este nome de usuário já está em uso.',
    'Current password is required': 'Informe a senha atual para trocar a senha.',
    'Current password is incorrect': 'A senha atual está incorreta.',
    'Researchers cannot edit their own profile': 'Pesquisadores não podem editar o próprio perfil. Fale com o administrador da empresa.',
    'User not found': 'Usuário não encontrado. Entre novamente.',
    'Envie uma imagem.': 'Escolha uma imagem para a foto de perfil.',
    'Use uma imagem JPG, PNG ou WebP.': 'Use uma imagem JPG, PNG ou WebP.',
    'A foto deve ter no máximo 5 MB.': 'A foto deve ter no máximo 5 MB.',
    'Armazenamento de imagens não configurado.': 'O armazenamento de imagens não está configurado no servidor.',
};

/** Converte o erro da API de perfil em um `Error` (foto grande demais tem mensagem própria). */
const profileError = async (response: Response, fallback: string) => {
    // O servidor recusa antes de ler o arquivo grande demais.
    if (response.status === 413) return new Error('A foto deve ter no máximo 5 MB.');

    const errorBody = await response.json().catch(() => null);
    // O validador da API devolve uma lista de mensagens quando um campo é inválido.
    const message = Array.isArray(errorBody?.message) ? errorBody.message[0] : errorBody?.message;
    return new Error(PROFILE_ERRORS[typeof message === 'string' ? message : ''] ?? fallback);
};

/** Busca o perfil do usuário logado. */
export const getProfile = async (): Promise<ProfileData> => {
    const response = await apiFetch('/auth/profile', { method: 'GET', credentials: 'include' });

    if (!response.ok) throw await profileError(response, 'Falha ao carregar o perfil');

    return response.json();
};

/** Salva nome, usuário e/ou senha do próprio usuário. A API renova o cookie de sessão. */
export const updateProfile = async (input: UpdateProfileInput): Promise<ProfileData> => {
    const response = await apiFetch('/auth/profile', {
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify(input),
    });

    if (!response.ok) throw await profileError(response, 'Falha ao salvar o perfil');

    const profile: ProfileData = await response.json();
    notifyUserUpdated();

    return profile;
};

/** Troca a foto de perfil: a imagem vai para o Cloudinary pela API. */
export const uploadAvatar = async (file: File): Promise<ProfileData> => {
    const body = new FormData();
    body.append('file', file);

    const response = await apiFetch('/auth/avatar', { method: 'POST', credentials: 'include', body });

    if (!response.ok) throw await profileError(response, 'Falha ao enviar a foto');

    const profile: ProfileData = await response.json();
    notifyUserUpdated();

    return profile;
};

/** Remove a foto de perfil (volta a mostrar as iniciais). */
export const removeAvatar = async (): Promise<ProfileData> => {
    const response = await apiFetch('/auth/avatar', { method: 'DELETE', credentials: 'include' });

    if (!response.ok) throw await profileError(response, 'Falha ao remover a foto');

    const profile: ProfileData = await response.json();
    notifyUserUpdated();

    return profile;
};

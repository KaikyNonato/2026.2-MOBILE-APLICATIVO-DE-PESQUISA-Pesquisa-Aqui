import { apiFetch } from "./apiFetcher";
import { asPage, pageQuery, type Page, type PageParams } from "./pagination";

/** Cadastra um usuário. */
export const createUser = async (
    name: string,
    username: string,
    password: string,
    profile: 'SUPERADMINISTRATOR' | 'ADMINISTRATOR' | 'RESEARCHER' | '',
    companyId?: number
) => {
    const response = await apiFetch(
        `/user`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
                name,
                username,
                password,
                profile,
                companyId,
            })
        }
    );

    if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.message || 'Failed to create user');
    }

    return response.json();
};

/** Lista os administradores. */
export const getUsersAdmin = async () => {
    const response = await apiFetch('/user/admins', {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) throw new Error('Failed to get admins');

    return response.json();
};

const USER_ERRORS: Record<string, string> = {
    'Researchers cannot manage users': 'Pesquisadores não podem gerenciar usuários.',
    'Administrators can only manage researchers from their own company': 'Você só pode gerenciar pesquisadores da sua própria empresa.',
    'You cannot delete your own account': 'Você não pode excluir a sua própria conta.',
    'Superadministrators cannot be deleted': 'Não é possível excluir um superadministrador.',
    'Superadministrators cannot be edited': 'Não é possível editar um superadministrador.',
    'Superadministrators cannot be deactivated': 'Não é possível desativar um superadministrador.',
    'You cannot deactivate your own account': 'Você não pode desativar a sua própria conta.',
    'User has collected data and cannot be deleted': 'Este usuário já possui coletas registradas e não pode ser excluído.',
    'Username already exists': 'Este nome de usuário já está em uso.',
    'Only company administrators can change access for all researchers': 'Somente o administrador da empresa pode alterar o acesso de todos os pesquisadores.',
    'Superadministrators cannot be reset by another user': 'Não é possível redefinir a senha de um superadministrador.',
    'Use the profile screen to change your own password': 'Para trocar a sua própria senha, use a tela de perfil.',
    'User not found': 'Usuário não encontrado. Atualize a lista e tente novamente.',
};

/** Converte o erro da API de usuários em um `Error` com texto em português. */
const userError = async (response: Response, fallback: string) => {
    const errorBody = await response.json().catch(() => null);
    const message = typeof errorBody?.message === 'string' ? errorBody.message : '';
    return new Error(USER_ERRORS[message] ?? fallback);
};

/** Exclui um usuário. */
export const deleteUser = async (username: string) => {
    const response = await apiFetch(`/user/${encodeURIComponent(username)}`, {
        method: 'DELETE',
        credentials: 'include',
    });

    if (!response.ok) throw await userError(response, 'Falha ao excluir usuário');

    return response.json();
};

/** Ativa ou desativa um usuário. */
export const setUserSituation = async (username: string, situation: UserSituation): Promise<UserItem> => {
    const response = await apiFetch(`/user/${encodeURIComponent(username)}/situation`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ situation }),
    });

    if (!response.ok) throw await userError(response, 'Falha ao alterar a situação do usuário');

    return response.json();
};

export interface ResearchersAccessResult {
    total: number;
    active: number;
    inactive: number;
}

/** Libera (ACTIVE) ou bloqueia (INACTIVE) o aplicativo para todos os pesquisadores da empresa. */
export const setAllResearchersSituation = async (situation: UserSituation): Promise<ResearchersAccessResult> => {
    const response = await apiFetch('/user/researchers/situation', {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ situation }),
    });

    if (!response.ok) throw await userError(response, 'Falha ao alterar o acesso dos pesquisadores');

    return response.json();
};

export interface UpdateUserInput {
    name?: string;
    username?: string;
    /** Só enviar quando a senha for trocada. */
    password?: string;
}

/** Edita os dados de um usuário. */
export const updateUser = async (username: string, input: UpdateUserInput): Promise<UserItem> => {
    const response = await apiFetch(`/user/${encodeURIComponent(username)}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(input),
    });

    if (!response.ok) throw await userError(response, 'Falha ao atualizar usuário');

    return response.json();
};

export type UserSituation = 'ACTIVE' | 'INACTIVE';

export interface UserItem {
    id: number;
    name: string;
    username: string;
    profile: 'SUPERADMINISTRATOR' | 'ADMINISTRATOR' | 'RESEARCHER';
    /** Ausente em respostas antigas: tratar como ACTIVE. */
    situation?: UserSituation;
    companyId: number | null;
    /** Foto de perfil (endereço no Cloudinary); nulo ou ausente = sem foto, mostra as iniciais. */
    avatarUrl?: string | null;
    /** Vem nas listas paginadas (evita carregar todas as empresas só para mostrar o nome). */
    companyName?: string | null;
    createdAt?: string;
    updatedAt?: string;
}

/** Lista os usuários que o usuário logado pode ver. */
export const getUsers = async (): Promise<UserItem[]> => {
    const response = await apiFetch('/user', {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) throw new Error('Falha ao carregar usuários');

    return response.json();
};

/** Lista só os pesquisadores. */
export const getResearchers = async (): Promise<UserItem[]> => {
    const users = await getUsers();
    return users.filter((u) => u.profile === 'RESEARCHER');
};

export type UserPageParams = PageParams & { situation?: UserSituation };

/** Uma página de pesquisadores (busca, situação e ordem no servidor). */
export const getResearchersPage = async (params: UserPageParams): Promise<Page<UserItem>> => {
    const response = await apiFetch(`/user${pageQuery(params, { profile: 'RESEARCHER' })}`, { method: 'GET', credentials: 'include' });
    if (!response.ok) throw new Error('Falha ao carregar pesquisadores');
    return asPage<UserItem>(await response.json(), params);
};

/** Uma página de administradores (só o superadministrador). */
export const getAdminsPage = async (params: UserPageParams): Promise<Page<UserItem>> => {
    const response = await apiFetch(`/user/admins${pageQuery(params)}`, { method: 'GET', credentials: 'include' });
    if (!response.ok) throw new Error('Failed to get admins');
    return asPage<UserItem>(await response.json(), params);
};

export interface ResearcherStats {
    total: number;
    active: number;
    inactive: number;
    /** Cadastrados nos últimos 30 dias. */
    recent: number;
    /** Empresas com ao menos um pesquisador. */
    companies: number;
    /** Cadastros por semana nas últimas 8 semanas (da mais antiga para a atual). */
    weekly: number[];
    referenceTime: number;
}

/** Totais do painel de pesquisadores, sem trazer a lista. */
export const getResearcherStats = async (): Promise<ResearcherStats> => {
    const response = await apiFetch('/user/researchers/stats', { method: 'GET', credentials: 'include' });
    if (!response.ok) throw new Error('Falha ao carregar os números de pesquisadores');
    return response.json();
};

/** Gera uma senha temporária para um usuário e a devolve. */
export const resetUserPassword = async (username: string): Promise<{ username: string; temporaryPassword: string }> => {
    const response = await apiFetch(`/user/${encodeURIComponent(username)}/reset-password`, {
        method: 'POST',
        credentials: 'include',
    });

    if (!response.ok) throw await userError(response, 'Falha ao redefinir a senha');

    return response.json();
};

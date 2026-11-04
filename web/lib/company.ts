import { apiFetch } from "./apiFetcher";
import { asPage, pageQuery, type Page, type PageParams } from "./pagination";

export interface CompanyItem {
    id: number;
    legalName: string;
    contactInformation: string;
    situation: 'ACTIVE' | 'INACTIVE';
    /** Logo e capa da empresa (endereços no Cloudinary); nulo ou ausente = sem imagem. */
    logoUrl?: string | null;
    coverUrl?: string | null;
    createdAt?: string;
    updatedAt?: string;
}

/** Cadastra uma empresa. */
export const createCompany = async (
    legalName: string,
    contactInformation: string,
    situation: 'ACTIVE' | 'INACTIVE'
) => {
    const response = await apiFetch(
        `/company`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
                legalName,
                contactInformation,
                situation
            })
        }
    );

    if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.message || 'Failed to create company');
    }

    return response.json();
};

/** Lista as empresas. */
export const getCompanies = async () => {
    const response = await apiFetch('/company', {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) throw new Error('Failed to get companies');

    return response.json();
};

/** Desativa uma empresa sem apagar os dados. */
export const deactivate = async (id: number) => {
    const response = await apiFetch(`/company/${id}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
    });

    if (!response.ok) throw new Error('Failed to deactivate company');

    return response.json();
};

const COMPANY_ERRORS: Record<string, string> = {
    'Only super administrators can edit companies.': 'Somente o superadministrador pode editar empresas.',
    'Only super administrators can delete companies.': 'Somente o superadministrador pode excluir empresas.',
    'Company not found': 'Empresa não encontrada. Atualize a lista e tente novamente.',
    'Company has linked users or researches and cannot be deleted':
        'Esta empresa possui usuários ou pesquisas vinculados e não pode ser excluída. Desative-a em vez disso.',
};

/** Converte o erro da API de empresas em um `Error` com texto em português. */
const companyError = async (response: Response, fallback: string) => {
    const errorBody = await response.json().catch(() => null);
    const message = typeof errorBody?.message === 'string' ? errorBody.message : '';
    return new Error(COMPANY_ERRORS[message] ?? fallback);
};

export interface UpdateCompanyInput {
    legalName?: string;
    contactInformation?: string;
    situation?: 'ACTIVE' | 'INACTIVE';
}

/** Edita os dados de uma empresa. */
export const updateCompany = async (id: number, input: UpdateCompanyInput): Promise<CompanyItem> => {
    const response = await apiFetch(`/company/${id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(input),
    });

    if (!response.ok) throw await companyError(response, 'Falha ao atualizar empresa');

    return response.json();
};

/** Exclui uma empresa. */
export const deleteCompany = async (id: number) => {
    const response = await apiFetch(`/company/${id}`, {
        method: 'DELETE',
        credentials: 'include',
    });

    if (!response.ok) throw await companyError(response, 'Falha ao excluir empresa');

    return response.json();
};

/** Uma página de empresas (busca, situação e ordem no servidor). */
export const getCompaniesPage = async (params: PageParams & { situation?: CompanyItem['situation'] }): Promise<Page<CompanyItem>> => {
    const response = await apiFetch(`/company${pageQuery(params)}`, { method: 'GET', credentials: 'include' });
    if (!response.ok) throw new Error('Failed to get companies');
    return asPage<CompanyItem>(await response.json(), params);
};

export interface CompanyStats {
    year: number;
    companies: number;
    activeCompanies: number;
    inactiveCompanies: number;
    admins: number;
    /** Cadastros por mês no ano (12 números). */
    companiesByMonth: number[];
    adminsByMonth: number[];
    /** As empresas mais novas (para o painel). */
    recentCompanies: { id: number; legalName: string; situation: 'ACTIVE' | 'INACTIVE' }[];
    /** Atividades mais recentes (empresas e administradores). */
    activities: { id: string; kind: 'company' | 'admin' | 'research' | 'researcher'; message: string; date: string }[];
}

/** Totais da tela de empresas, sem trazer as listas. */
export const getCompanyStats = async (): Promise<CompanyStats> => {
    const response = await apiFetch('/company/stats', { method: 'GET', credentials: 'include' });
    if (!response.ok) throw new Error('Falha ao carregar os números das empresas');
    return response.json();
};

/** Empresas ativas no formato do <RemoteComboBox> (value = id, label = razão social): pesquisa e página vêm do servidor. */
export const getCompanyOptions = async (params: { page: number; pageSize: number; q: string }) => {
    const page = await getCompaniesPage({ ...params, situation: 'ACTIVE', sort: 'name' });
    return { ...page, items: page.items.map((company) => ({ value: String(company.id), label: company.legalName })) };
};

export type CompanyImageKind = 'logo' | 'cover';

/** Tipos e tamanho aceitos nas imagens da empresa (o servidor confere de novo). */
export const COMPANY_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const COMPANY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_ERRORS: Record<string, string> = {
    'Envie uma imagem.': 'Escolha uma imagem.',
    'Use uma imagem JPG, PNG ou WebP.': 'Use uma imagem JPG, PNG ou WebP.',
    'A foto deve ter no máximo 5 MB.': 'A imagem deve ter no máximo 5 MB.',
    'Armazenamento de imagens não configurado.': 'O armazenamento de imagens não está configurado no servidor.',
    'Only the company administrator can change its images.': 'Só o administrador da empresa pode alterar as imagens.',
};

/**
 * Converte o erro da API de imagens da empresa em um `Error` (imagem grande demais tem mensagem
 * própria).
 */
const imageError = async (response: Response, fallback: string) => {
    // O servidor recusa antes de ler o arquivo grande demais.
    if (response.status === 413) return new Error('A imagem deve ter no máximo 5 MB.');

    const errorBody = await response.json().catch(() => null);
    const message = Array.isArray(errorBody?.message) ? errorBody.message[0] : errorBody?.message;

    return new Error(IMAGE_ERRORS[typeof message === 'string' ? message : ''] ?? fallback);
};

/** Troca o logo ou a capa da empresa: a imagem vai para o Cloudinary pela API. Devolve a empresa atualizada. */
export const uploadCompanyImage = async (companyId: number, kind: CompanyImageKind, file: File): Promise<CompanyItem> => {
    const body = new FormData();
    body.append('file', file);

    const response = await apiFetch(`/company/${companyId}/images/${kind}`, { method: 'POST', credentials: 'include', body });

    if (!response.ok) throw await imageError(response, 'Falha ao enviar a imagem');

    return response.json();
};

/** Remove o logo ou a capa de uma empresa. */
export const removeCompanyImage = async (companyId: number, kind: CompanyImageKind): Promise<CompanyItem> => {
    const response = await apiFetch(`/company/${companyId}/images/${kind}`, { method: 'DELETE', credentials: 'include' });

    if (!response.ok) throw await imageError(response, 'Falha ao remover a imagem');

    return response.json();
};

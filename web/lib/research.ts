import { apiFetch } from "./apiFetcher";
import { MONTH_NAMES } from "./dashboard";
import { asPage, pageQuery, type Page, type PageParams } from "./pagination";
import type { UserItem } from "./user";

export interface Research {
    id: number;
    title: string;
    description: string;
    objective: string;
    status: "DRAFT" | "PUBLISHED" | "IN_FIELD" | "CLOSED";
    startDate: string;
    endDate: string;
    targetAudience: string;
    recordInterview: boolean;
    /** Área-alvo (círculo) usada na auditoria de qualidade. Tudo nulo = sem área. */
    areaLatitude?: number | null;
    areaLongitude?: number | null;
    areaRadiusKm?: number | null;
    /** true enquanto há cópia ativa (pesquisa baixada em algum aparelho) ou a pesquisa está encerrada: a estrutura do questionário não muda. */
    locked?: boolean;
    /** Por que está travada: ACTIVE_COPIES (há aparelho com a pesquisa) ou CLOSED (encerrada). null = editável. */
    lockReason?: "ACTIVE_COPIES" | "CLOSED" | null;
    /** Texto pronto, vindo do servidor, explicando a trava. */
    lockMessage?: string | null;
    /** Quantos aparelhos estão com a pesquisa baixada agora. */
    activeCopies?: number;
    /** true enquanto nenhum pesquisador baixou a pesquisa: só então ela pode ser excluída. */
    canDelete?: boolean;
    companyId: number;
    createdAt?: string;
    updatedAt?: string;
}
//Pesquisas que vão aparecer no grafico de "Pesquisas Ativas" na pagina HOME 
const ACTIVE_STATUSES: Research["status"][] = ["PUBLISHED", "IN_FIELD"];

export const createResearch = async (title: string, description: string, objective: string, startDate: string, endDate: string, targetAudience: string, recordInterview = false) => {
    const response = await apiFetch(
        `/research`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                title,
                description,
                objective,
                startDate,
                endDate,
                targetAudience,
                recordInterview,
            })
        }
    );

    if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.message || 'Failed to create user');
    }

    return response.json();
}

export const getResearches = async (): Promise<Research[]> => {
    const response = await apiFetch('/research', {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        console.error('getResearches failed:', response.status, errorBody);
        throw new Error(errorBody?.message || `Failed to get researches (status ${response.status})`);
    }

    return response.json();
}

/** Pesquisa da lista paginada: já traz as coletas recebidas e a equipe (só desta página). */
export type ResearchListItem = Research & {
    collected: number;
    team: { id: number; name: string; username: string; avatarUrl?: string | null }[];
};

/** Uma página de pesquisas (painel web). Filtros e busca são feitos no servidor. */
export const getResearchesPage = async (params: PageParams & { status?: Research["status"] }): Promise<Page<ResearchListItem>> => {
    const response = await apiFetch(`/research${pageQuery(params)}`, { method: 'GET', credentials: 'include' });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.message || `Failed to get researches (status ${response.status})`);
    }

    return asPage<ResearchListItem>(await response.json(), params);
}

export interface ResearchSummary {
    total: number;
    /** Coletas recebidas em todas as pesquisas. */
    collections: number;
    byStatus: Record<Research["status"], number>;
}

/** Quantas pesquisas há em cada situação, sem trazer as pesquisas. */
export const getResearchSummary = async (): Promise<ResearchSummary> => {
    const response = await apiFetch('/research/summary', { method: 'GET', credentials: 'include' });
    if (!response.ok) throw new Error('Falha ao carregar o resumo das pesquisas');
    return response.json();
}

export function getActiveResearchesInMonth(
    researches: Research[],
    month: number,
    year: number
): Research[] {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);

    return researches.filter((r) => {
        if (!ACTIVE_STATUSES.includes(r.status)) return false;

        const start = new Date(r.startDate);
        const end = new Date(r.endDate);

        return start <= monthEnd && end >= monthStart;
    });
}

export function getResearchesByMonth(
    researches: Research[],
    year: number
): { month: string; Pesquisas: number }[] {
    return MONTH_NAMES.map((month, i) => {
        const activeInThisMonth = getActiveResearchesInMonth(researches, i + 1, year);
        return { month, Pesquisas: activeInThisMonth.length };
    });
}

export const getResearchById = async (id: string): Promise<Research> => {
    const response = await apiFetch(`/research/${id}`, {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const error = new Error(errorBody?.message || 'Failed to get research') as Error & { status?: number };
        error.status = response.status;
        throw error;
    }

    return response.json();
};

export const deleteResearch = async (id: number): Promise<void> => {
    const response = await apiFetch(`/research/${id}`, {
        method: 'DELETE',
        credentials: 'include',
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.message || 'Failed to delete research');
    }
}

export const publishResearch = async (id: number): Promise<Research> => {
    const response = await apiFetch(`/research/${id}/publish`, {
        method: 'POST',
        credentials: 'include',
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.message || 'Failed to publish research');
    }

    return response.json();
};

/** Volta uma pesquisa publicada para rascunho (só se nenhum pesquisador a baixou). */
export const unpublishResearch = async (id: number): Promise<Research> => {
    const response = await apiFetch(`/research/${id}/unpublish`, {
        method: 'POST',
        credentials: 'include',
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.message || 'Failed to unpublish research');
    }

    return response.json();
};

export interface ResearchResearcherLink {
    id: number;
    researchId: number;
    userId: number;
    name?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
    /** Meta de coletas deste pesquisador nesta pesquisa; null = sem meta definida. */
    targetCount?: number | null;
    /** Quantas coletas ele já entregou nesta pesquisa. */
    collected?: number;
    remaining?: number | null;
    /** 0 a 100; null quando não há meta. */
    progress?: number | null;
}

const readError = async (response: Response, fallback: string) => {
    const errorBody = await response.json().catch(() => null);
    const message = Array.isArray(errorBody?.message) ? errorBody.message.join(', ') : errorBody?.message;
    return new Error(message || fallback);
};

export const getResearchLinkedResearchers = async (researchId: number): Promise<ResearchResearcherLink[]> => {
    const response = await apiFetch(`/research/${researchId}/researchers`, { method: 'GET', credentials: 'include' });
    if (!response.ok) throw await readError(response, 'Falha ao carregar pesquisadores vinculados');
    return response.json();
};

/** Uma página dos pesquisadores vinculados (busca no servidor). */
export const getResearchLinkedPage = async (researchId: number, params: PageParams): Promise<Page<ResearchResearcherLink>> => {
    const response = await apiFetch(`/research/${researchId}/researchers${pageQuery(params)}`, { method: 'GET', credentials: 'include' });
    if (!response.ok) throw await readError(response, 'Falha ao carregar pesquisadores vinculados');
    return asPage<ResearchResearcherLink>(await response.json(), params);
};

/** Pesquisador da empresa com o vínculo dele nesta pesquisa (nulo = disponível). */
export type ResearchTeamMember = UserItem & { link: ResearchResearcherLink | null };

export type ResearchTeamPage = Page<ResearchTeamMember> & {
    summary: { total: number; linked: number; linkedPreview: { id: number; name: string; avatarUrl?: string | null }[] };
};

/** Uma página da equipe da pesquisa: pesquisadores da empresa, vinculados primeiro (busca e filtro no servidor). */
export const getResearchTeamPage = async (
    researchId: number,
    params: PageParams & { filter?: 'ALL' | 'LINKED' | 'AVAILABLE' },
): Promise<ResearchTeamPage> => {
    const response = await apiFetch(`/research/${researchId}/team${pageQuery(params)}`, { method: 'GET', credentials: 'include' });
    if (!response.ok) throw await readError(response, 'Falha ao carregar a equipe da pesquisa');
    return response.json();
};

export const linkResearcher = async (researchId: number, userId: number, targetCount?: number): Promise<void> => {
    const response = await apiFetch(`/research/${researchId}/researchers/${userId}`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(targetCount === undefined ? {} : { targetCount }),
    });
    if (!response.ok) throw await readError(response, 'Falha ao vincular pesquisador');
};

/** Altera a meta de um pesquisador já vinculado (vale também com a pesquisa em campo). */
export const updateResearcherTarget = async (researchId: number, userId: number, targetCount: number): Promise<void> => {
    const response = await apiFetch(`/research/${researchId}/researchers/${userId}`, {
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({ targetCount }),
    });
    if (!response.ok) throw await readError(response, 'Falha ao alterar a meta');
};

export const unlinkResearcher = async (researchId: number, userId: number): Promise<void> => {
    const response = await apiFetch(`/research/${researchId}/researchers/${userId}`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) throw await readError(response, 'Falha ao desvincular pesquisador');
};

// ---------- cópias em campo (W11) ----------

export type ResearchCopyStatus = "ACTIVE" | "RETURNED" | "REVOKED";

export interface ResearchCopy {
    id: number;
    researchId: number;
    status: ResearchCopyStatus;
    userId: number | null;
    researcherName: string | null;
    researcherUsername: string | null;
    researcherAvatarUrl?: string | null;
    deviceId: string;
    /** Data do download (ou do último "atualizar" feito nesse aparelho). */
    downloadedAt: string;
    returnedAt: string | null;
    revokedAt: string | null;
    revokedByName: string | null;
    revokeReason: string | null;
    /** Quando o administrador desbloqueou o aparelho (a revogação continua no histórico). */
    unblockedAt: string | null;
    unblockedByName: string | null;
    /** O aparelho desta cópia está bloqueado agora: dá para desbloquear. */
    deviceBlocked: boolean;
}

export interface ResearchCopies {
    researchId: number;
    locked: boolean;
    lockReason: "ACTIVE_COPIES" | "CLOSED" | null;
    lockMessage: string | null;
    activeCopies: number;
    /** Ativas primeiro; depois devolvidas e revogadas (histórico). */
    copies: ResearchCopy[];
}

/** Quem está com a pesquisa baixada, o motivo da trava e o histórico de devoluções e revogações. */
export const getResearchCopies = async (researchId: number): Promise<ResearchCopies> => {
    const response = await apiFetch(`/research/${researchId}/copies`, { method: 'GET', credentials: 'include' });
    if (!response.ok) throw await readError(response, 'Falha ao carregar as cópias em campo');
    return response.json();
};

/** Cópia do histórico: `unblockable` = o botão de desbloquear aparece nela. */
export type ResearchCopyHistoryItem = ResearchCopy & { unblockable: boolean };

export interface ResearchCopiesRevokedUser {
    key: string;
    name: string | null;
    username: string | null;
    avatarUrl?: string | null;
    devices: ResearchCopy[];
    blocked: number;
    revocations: number;
}

/** Cópias em campo em partes limitadas: ativas, usuários revogados e o histórico em páginas. */
export interface ResearchCopiesOverview {
    researchId: number;
    locked: boolean;
    lockReason: "ACTIVE_COPIES" | "CLOSED" | null;
    lockMessage: string | null;
    activeCopies: number;
    active: ResearchCopy[];
    activeTotal: number;
    revokedUsers: ResearchCopiesRevokedUser[];
    revokedUsersTotal: number;
    historyTotal: number;
    history: Page<ResearchCopyHistoryItem>;
}

export const getResearchCopiesPage = async (
    researchId: number,
    params: PageParams & { status?: "ALL" | "RETURNED" | "REVOKED" },
): Promise<ResearchCopiesOverview> => {
    const response = await apiFetch(`/research/${researchId}/copies${pageQuery(params)}`, { method: 'GET', credentials: 'include' });
    if (!response.ok) throw await readError(response, 'Falha ao carregar as cópias em campo');
    return response.json();
};

/** Revogação forçada (aparelho perdido, quebrado, pesquisador que saiu): libera o contador e invalida o acesso do aparelho. */
export const revokeResearchCopy = async (researchId: number, copyId: number, reason?: string): Promise<void> => {
    const response = await apiFetch(`/research/${researchId}/copies/${copyId}/revoke`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(reason?.trim() ? { reason: reason.trim() } : {}),
    });
    if (!response.ok) throw await readError(response, 'Falha ao revogar a cópia');
};

/** Desbloquear aparelho: desfaz a revogação para o aparelho voltar a baixar a pesquisa. O histórico fica. */
export const unblockResearchDevice = async (researchId: number, copyId: number): Promise<void> => {
    const response = await apiFetch(`/research/${researchId}/copies/${copyId}/unblock`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({}),
    });
    if (!response.ok) throw await readError(response, 'Falha ao desbloquear o aparelho');
};


// ---------- duplicar e modelos prontos ----------

export interface ResearchTemplate {
    id: string;
    name: string;
    category: string;
    description: string;
    objective: string;
    targetAudience: string;
    recordInterview: boolean;
    sectionCount: number;
    questionCount: number;
    ruleCount: number;
    sections: { title: string; questions: { statement: string; type: string }[] }[];
}

const errorFrom = async (response: Response, fallback: string) => {
    const body = await response.json().catch(() => null);
    const message = Array.isArray(body?.message) ? body.message.join(" ") : body?.message;
    return new Error(message || fallback);
};

export const getResearchTemplates = async (): Promise<ResearchTemplate[]> => {
    const response = await apiFetch('/research/templates', { method: 'GET', credentials: 'include' });
    if (!response.ok) throw await errorFrom(response, 'Falha ao carregar os modelos');
    return response.json();
};

/** Cria um rascunho a partir de um modelo pronto. Tudo além de `templateId` é opcional. */
export const createResearchFromTemplate = async (payload: {
    templateId: string; title?: string; description?: string; objective?: string; targetAudience?: string; startDate?: string; endDate?: string; companyId?: number;
}): Promise<Research> => {
    const response = await apiFetch('/research/from-template', { method: 'POST', credentials: 'include', body: JSON.stringify(payload) });
    if (!response.ok) throw await errorFrom(response, 'Falha ao criar a pesquisa a partir do modelo');
    return response.json();
};

/** Duplica a estrutura (seções, questões, opções e regras) em um novo rascunho. Não leva coletas nem pesquisadores. */
export const duplicateResearch = async (id: number, title?: string): Promise<Research> => {
    const response = await apiFetch(`/research/${id}/duplicate`, { method: 'POST', credentials: 'include', body: JSON.stringify(title ? { title } : {}) });
    if (!response.ok) throw await errorFrom(response, 'Falha ao duplicar a pesquisa');
    return response.json();
};

/** Define (ou remove, com `null`) a área-alvo da pesquisa. */
export const updateResearchArea = async (id: number, area: { areaLatitude: number | null; areaLongitude: number | null; areaRadiusKm: number | null }): Promise<Research> => {
    const response = await apiFetch(`/research/${id}`, { method: 'PATCH', credentials: 'include', body: JSON.stringify(area) });
    if (!response.ok) throw await errorFrom(response, 'Falha ao salvar a área-alvo');
    return response.json();
};

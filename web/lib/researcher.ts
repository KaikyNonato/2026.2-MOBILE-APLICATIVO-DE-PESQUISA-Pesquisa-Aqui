import { apiFetch } from "./apiFetcher";
import type { Research } from "./research";

/**
 * Pesquisa como o pesquisador a enxerga: só as dele (sem rascunhos), com a meta do vínculo
 * (`targetCount`, nulo = sem meta) e quantas coletas dele o servidor já recebeu (`collected`).
 */
export type MyResearch = Research & {
    targetCount: number | null;
    collected: number;
};

/** Pesquisas em que o pesquisador logado está vinculado (GET /research devolve a lista dele). */
export const getMyResearches = async (): Promise<MyResearch[]> => {
    const response = await apiFetch('/research', { method: 'GET', credentials: 'include' });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(typeof errorBody?.message === 'string' ? errorBody.message : 'Falha ao carregar as suas pesquisas');
    }

    const data = await response.json();

    return Array.isArray(data) ? data : [];
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const MY_STATUS_LABELS: Record<Research["status"], string> = {
    DRAFT: "Rascunho",
    PUBLISHED: "Publicada",
    IN_FIELD: "Em campo",
    CLOSED: "Encerrada",
};

/** Pesquisa em que ainda dá para coletar. */
export const isOpenForCollection = (research: Pick<Research, "status">) =>
    research.status === "PUBLISHED" || research.status === "IN_FIELD";

/** Dias até o prazo (negativo = já passou). */
export const daysUntil = (endDate: string, now: number) =>
    Math.ceil((new Date(endDate).getTime() - now) / DAY_MS);

/** Quanto da meta já foi coletado, de 0 a 100. Nulo quando a pesquisa não tem meta. */
export const progressPercent = (research: Pick<MyResearch, "targetCount" | "collected">): number | null => {
    if (!research.targetCount || research.targetCount <= 0) return null;
    return Math.min(100, Math.round((research.collected / research.targetCount) * 100));
};

const STATUS_ORDER: Record<Research["status"], number> = { IN_FIELD: 0, PUBLISHED: 1, CLOSED: 2, DRAFT: 3 };

/** Em campo primeiro, depois publicadas e encerradas; dentro de cada grupo, o prazo mais próximo antes. */
export const sortMyResearches = (list: MyResearch[]): MyResearch[] =>
    [...list].sort(
        (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            new Date(a.endDate).getTime() - new Date(b.endDate).getTime(),
    );

/** Formata uma data ISO como dia, mês abreviado e ano (`—` se vazia ou inválida). */
export const formatShortDate = (iso?: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
};

/** Texto do prazo: "faltam 5 dias", "termina hoje", "encerrada há 3 dias". */
export const deadlineLabel = (days: number): string => {
    if (days > 1) return `faltam ${days} dias`;
    if (days === 1) return "falta 1 dia";
    if (days === 0) return "termina hoje";
    if (days === -1) return "prazo acabou ontem";
    return `prazo acabou há ${Math.abs(days)} dias`;
};

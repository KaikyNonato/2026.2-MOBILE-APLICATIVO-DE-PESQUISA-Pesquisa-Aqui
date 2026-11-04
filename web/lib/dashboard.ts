import type { CompanyItem } from "./company";
import type { Research } from "./research";
import type { UserItem } from "./user";

export const MONTH_NAMES = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export type ChartPoint = { month: string } & Record<string, string | number>;

/**
 * Conta quantos itens foram criados em cada mês do ano informado.
 * O resultado já vem no formato esperado pelo componente <Chart />.
 */
export function countByMonth<T>(
    items: T[],
    getDate: (item: T) => string | undefined,
    year: number,
    seriesKey: string
): ChartPoint[] {
    const counts = new Array<number>(12).fill(0);

    for (const item of items) {
        const raw = getDate(item);
        if (!raw) continue;

        const date = new Date(raw);
        if (Number.isNaN(date.getTime()) || date.getFullYear() !== year) continue;

        counts[date.getMonth()] += 1;
    }

    return MONTH_NAMES.map((month, i) => ({ month, [seriesKey]: counts[i] }));
}

/** Cadastros por mês que já vêm contados da API (12 números) no formato do <Chart />. */
export function monthsToChart(counts: number[], seriesKey: string): ChartPoint[] {
    return MONTH_NAMES.map((month, i) => ({ month, [seriesKey]: counts[i] ?? 0 }));
}

export type ActivityKind = "company" | "admin" | "research" | "researcher";

export interface ActivityItem {
    id: string;
    kind: ActivityKind;
    message: string;
    date: Date;
}

// Diferença mínima entre updatedAt e createdAt para considerar que houve uma edição de fato.
const EDIT_THRESHOLD_MS = 2000;

/** Converte um texto em data (`null` se vazio ou inválido). */
const parseDate = (raw?: string): Date | null => {
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
};

/** Diz se o registro foi alterado depois de criado (acima de `EDIT_THRESHOLD_MS`). */
const wasEdited = (createdAt: Date | null, updatedAt: Date | null) =>
    !!createdAt && !!updatedAt && updatedAt.getTime() - createdAt.getTime() > EDIT_THRESHOLD_MS;

/** Ordena as atividades da mais nova para a mais antiga e corta no limite. */
const sortRecent = (items: ActivityItem[], limit: number) =>
    items.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, limit);

/** Atividades exibidas para o super administrador: empresas e administradores. */
export function buildSuperAdminActivities(
    companies: CompanyItem[],
    admins: UserItem[],
    limit = 10
): ActivityItem[] {
    const items: ActivityItem[] = [];

    for (const company of companies) {
        const created = parseDate(company.createdAt);
        const updated = parseDate(company.updatedAt);

        if (created) {
            items.push({
                id: `company-${company.id}-created`,
                kind: "company",
                message: `Empresa “${company.legalName}” cadastrada`,
                date: created,
            });
        }

        if (updated && wasEdited(created, updated)) {
            items.push({
                id: `company-${company.id}-updated`,
                kind: "company",
                message:
                    company.situation === "INACTIVE"
                        ? `Empresa “${company.legalName}” desativada`
                        : `Empresa “${company.legalName}” atualizada`,
                date: updated,
            });
        }
    }

    for (const admin of admins) {
        const created = parseDate(admin.createdAt);
        if (!created) continue;

        items.push({
            id: `admin-${admin.id}-created`,
            kind: "admin",
            message: `Administrador “${admin.name}” cadastrado`,
            date: created,
        });
    }

    return sortRecent(items, limit);
}

const RESEARCH_UPDATE_MESSAGES: Record<Research["status"], string> = {
    DRAFT: "atualizada",
    PUBLISHED: "publicada",
    IN_FIELD: "colocada em campo",
    CLOSED: "encerrada",
};

/** Atividades exibidas para o administrador: pesquisas e pesquisadores da sua empresa. */
export function buildAdminActivities(
    researches: Research[],
    researchers: UserItem[],
    limit = 10
): ActivityItem[] {
    const items: ActivityItem[] = [];

    for (const research of researches) {
        const created = parseDate(research.createdAt);
        const updated = parseDate(research.updatedAt);

        if (created) {
            items.push({
                id: `research-${research.id}-created`,
                kind: "research",
                message: `Pesquisa “${research.title}” criada`,
                date: created,
            });
        }

        if (updated && wasEdited(created, updated)) {
            items.push({
                id: `research-${research.id}-updated`,
                kind: "research",
                message: `Pesquisa “${research.title}” ${RESEARCH_UPDATE_MESSAGES[research.status] ?? "atualizada"}`,
                date: updated,
            });
        }
    }

    for (const researcher of researchers) {
        const created = parseDate(researcher.createdAt);
        if (!created) continue;

        items.push({
            id: `researcher-${researcher.id}-created`,
            kind: "researcher",
            message: `Pesquisador “${researcher.name}” cadastrado`,
            date: created,
        });
    }

    return sortRecent(items, limit);
}

const relativeFormatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/** "há 5 minutos", "ontem", "há 3 dias"... Acima de 30 dias mostra a data. */
export function formatRelativeTime(date: Date, now: number = Date.now()): string {
    const diffSeconds = Math.round((date.getTime() - now) / 1000);
    const abs = Math.abs(diffSeconds);

    if (abs < 60) return "agora há pouco";
    if (abs < 3600) return relativeFormatter.format(Math.round(diffSeconds / 60), "minute");
    if (abs < 86400) return relativeFormatter.format(Math.round(diffSeconds / 3600), "hour");
    if (abs < 30 * 86400) return relativeFormatter.format(Math.round(diffSeconds / 86400), "day");

    return date.toLocaleDateString("pt-BR");
}

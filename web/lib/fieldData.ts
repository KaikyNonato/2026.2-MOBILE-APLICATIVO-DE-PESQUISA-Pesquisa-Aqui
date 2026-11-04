import { apiFetch } from "./apiFetcher";
import type { Research } from "./research";
import type { UserItem } from "./user";

/**
 * Dados de campo do painel do administrador. O servidor (GET /dashboard/admin) calcula tudo e devolve só
 * o resultado: totais, gráficos mensais, mapa de calor, equipe do dia e as atividades mais recentes.
 * O navegador não baixa mais todas as pesquisas, pesquisadores e coletas da empresa.
 */

export interface AdminDashboard {
    generatedAt: number;
    year: number;
    /** 1 a 12. */
    month: number;
    totals: { researches: number; researchers: number; inField: number };
    byStatus: Record<Research["status"], number>;
    activeThisMonth: number;
    activePrevMonth: number;
    /** Pesquisas ativas em cada mês do ano (12 números). */
    activeByMonth: number[];
    /** Pesquisadores cadastrados em cada mês do ano (12 números). */
    researchersByMonth: number[];
    pins: { id: number; title: string; endDate: string }[];
    team: {
        total: number;
        rows: { id: number; name: string; username: string; avatarUrl?: string | null; collectionsToday: number; lastAt: string | null; inField: boolean }[];
    };
    heatmap: Heatmap;
    activities: { id: string; kind: "company" | "admin" | "research" | "researcher"; message: string; date: string }[];
}

const CACHE_TTL_MS = 30_000;

let cached: AdminDashboard | null = null;
let inFlight: Promise<AdminDashboard> | null = null;

/** Busca o painel do administrador na API, informando o fuso horário do navegador. */
async function fetchDashboard(): Promise<AdminDashboard> {
    const response = await apiFetch(`/dashboard/admin?tzOffset=${new Date().getTimezoneOffset()}`, { method: "GET", credentials: "include" });
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || `Falha ao carregar o painel (status ${response.status})`);
    }
    return response.json();
}

/** Carrega (ou reaproveita por 30 s) o painel. Várias telas pedem juntas e só uma consulta sai. */
export function loadAdminDashboard(force = false): Promise<AdminDashboard> {
    if (!force && cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) return Promise.resolve(cached);
    if (inFlight) return inFlight;

    inFlight = fetchDashboard()
        .then((data) => {
            cached = data;
            return data;
        })
        .finally(() => {
            inFlight = null;
        });

    return inFlight;
}

/* ------------------------------------------------------------------
   Quem está em campo
   ------------------------------------------------------------------ */

/** Um pesquisador conta como "em campo" se terminou uma coleta nesta janela (o servidor usa a mesma). */
export const IN_FIELD_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface TeamRow {
    user: Pick<UserItem, "id" | "name" | "username" | "avatarUrl">;
    collectionsToday: number;
    lastAt: Date | null;
    inField: boolean;
}

/** Linhas da equipe do painel (já ordenadas pelo servidor: quem está em campo vem primeiro). */
export function teamRowsOf(dashboard: Pick<AdminDashboard, "team"> | null | undefined): TeamRow[] {
    return (dashboard?.team.rows ?? []).map((row) => ({
        user: { id: row.id, name: row.name, username: row.username, avatarUrl: row.avatarUrl ?? null },
        collectionsToday: row.collectionsToday,
        lastAt: row.lastAt ? new Date(row.lastAt) : null,
        inField: row.inField,
    }));
}

/* ------------------------------------------------------------------
   Mapa de calor: dia da semana x horário
   ------------------------------------------------------------------ */

export const HEAT_DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"] as const;
export const HEAT_DAY_NAMES = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"] as const;
export const HEAT_FIRST_HOUR = 8;
export const HEAT_HOURS = 12;
const HEAT_WINDOW_DAYS = 28;

export interface Heatmap {
    /** cells[dia][coluna] = coletas; dia 0 = segunda, coluna 0 = 8h. */
    cells: number[][];
    /** Nível de cor (0 a 4) de cada célula. */
    levels: number[][];
    total: number;
    /** Coletas fora da faixa de horários exibida. */
    outside: number;
    peak: { day: number; hour: number; count: number } | null;
}

/* ------------------------------------------------------------------
   Pesquisas: período e andamento
   ------------------------------------------------------------------ */

/** "2026-10-01" ou ISO -> data local, sem o deslocamento de fuso que `new Date("2026-10-01")` causa. */
export function parseCalendarDate(raw?: string): Date | null {
    if (!raw) return null;
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** Completa o número com zero à esquerda (2 dígitos). */
const pad = (n: number) => String(n).padStart(2, "0");

/** "01/10 a 30/11" (com o ano quando as datas não são do ano atual). */
export function formatPeriod(start?: string, end?: string, now = new Date()): string {
    const s = parseCalendarDate(start);
    const e = parseCalendarDate(end);
    if (!s || !e) return "Período não definido";
    const sameYear = s.getFullYear() === now.getFullYear() && e.getFullYear() === now.getFullYear();
    const fmt = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}${sameYear ? "" : `/${d.getFullYear()}`}`;
    return `${fmt(s)} a ${fmt(e)}`;
}

/** Dias de calendário até o último dia da pesquisa (0 = termina hoje; negativo = já terminou). */
export function daysUntilEnd(end: string | undefined, now: number): number | null {
    const e = parseCalendarDate(end);
    if (!e) return null;
    const today = new Date(now);
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    return Math.round((new Date(e.getFullYear(), e.getMonth(), e.getDate()).getTime() - startOfToday) / 86_400_000);
}

/** Quanto do período da pesquisa já passou, de 0 a 1. */
export function periodProgress(research: Pick<Research, "status" | "startDate" | "endDate">, now: number): number {
    if (research.status === "CLOSED") return 1;
    const s = parseCalendarDate(research.startDate);
    const e = parseCalendarDate(research.endDate);
    if (!s || !e) return 0;
    const end = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1).getTime();
    const span = end - s.getTime();
    if (span <= 0) return 0;
    return Math.max(0, Math.min(1, (now - s.getTime()) / span));
}

/* ------------------------------------------------------------------
   Apresentação de pessoas
   ------------------------------------------------------------------ */

/** Iniciais (até duas letras) de um nome. */
export const initialsOf = (name?: string) =>
    (name ?? "")
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "?";

/** Cor fixa do avatar de cada pessoa (a1 a a4, definidas no CSS). */
export const avatarTone = (id: number) => `a${(Math.abs(id) % 4) + 1}`;

import { apiFetch } from "./apiFetcher";

// W12 — painel, relatório, exportação e encerramento.

export interface ReportFilters {
    /** Dia inicial (AAAA-MM-DD, no fuso do navegador). */
    from?: string;
    /** Dia final (AAAA-MM-DD, no fuso do navegador). */
    to?: string;
    researcherId?: number;
    /** Mapa e qualidade: só coletas com alerta de atenção. */
    flagged?: boolean;
}

export interface PanelResearcher {
    userId: number;
    name: string;
    username: string | null;
    avatarUrl?: string | null;
    /** false = foi desvinculado depois de entregar coletas. */
    linked: boolean;
    targetCount: number | null;
    collected: number;
    /** 0 a 100; null quando não há meta. */
    progress: number | null;
    lastSyncAt: string | null;
    lastCollectionAt: string | null;
    averageSeconds: number | null;
    /** Média bem abaixo da dos colegas. */
    suspiciouslyFast: boolean;
}

export interface ResearchPanel {
    researchId: number;
    title: string;
    status: "DRAFT" | "PUBLISHED" | "IN_FIELD" | "CLOSED";
    closedAt: string | null;
    generatedAt: string;
    totalCollections: number;
    targetTotal: number | null;
    goalPercent: number | null;
    averageSeconds: number | null;
    lastSyncAt: string | null;
    researchers: PanelResearcher[];
}

export interface ChartDatum {
    key: string;
    label: string;
    count: number;
    percent: number;
}

export interface QuestionChart {
    questionId: number;
    statement: string;
    type: "YES_NO" | "SINGLE_CHOICE" | "MULTIPLE_CHOICE";
    answered: number;
    totalCollections: number;
    data: ChartDatum[];
}

export interface ResearchReport {
    researchId: number;
    status: ResearchPanel["status"];
    totalCollections: number;
    questions: QuestionChart[];
}

// O dia escolhido vale no fuso de quem está olhando: 00:00 do primeiro dia até 23:59:59 do último.
const startOfDay = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const endOfDay = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

export const reportQueryString = (filters: ReportFilters): string => {
    const params = new URLSearchParams();
    if (filters.from) params.set("from", startOfDay(filters.from));
    if (filters.to) params.set("to", endOfDay(filters.to));
    if (filters.researcherId !== undefined) params.set("researcherId", String(filters.researcherId));
    if (filters.flagged) params.set("flagged", "true");
    const text = params.toString();
    return text ? `?${text}` : "";
};

const readError = async (response: Response, fallback: string) => {
    const errorBody = await response.json().catch(() => null);
    const message = Array.isArray(errorBody?.message) ? errorBody.message.join(", ") : errorBody?.message;
    const error = new Error(message || fallback) as Error & { status?: number };
    error.status = response.status;
    return error;
};

export const getResearchPanel = async (researchId: number, filters: ReportFilters = {}): Promise<ResearchPanel> => {
    const response = await apiFetch(`/research/${researchId}/panel${reportQueryString(filters)}`, { method: "GET", credentials: "include" });
    if (!response.ok) throw await readError(response, "Falha ao carregar o painel");
    return response.json();
};

export const getResearchReport = async (researchId: number, filters: ReportFilters = {}): Promise<ResearchReport> => {
    const response = await apiFetch(`/research/${researchId}/report${reportQueryString(filters)}`, { method: "GET", credentials: "include" });
    if (!response.ok) throw await readError(response, "Falha ao carregar o relatório");
    return response.json();
};

/** Baixa o CSV (uma linha por coleta, uma coluna por questão) com os mesmos filtros da tela. */
export const downloadResearchCsv = async (researchId: number, filters: ReportFilters = {}): Promise<void> => {
    const response = await apiFetch(`/research/${researchId}/export.csv${reportQueryString(filters)}`, { method: "GET", credentials: "include" });
    if (!response.ok) throw await readError(response, "Falha ao exportar as coletas");

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pesquisa-${researchId}-coletas.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export type ExportKind = "csv" | "xlsx" | "json" | "pdf";

const EXPORT_PATH: Record<ExportKind, { path: string; file: string }> = {
    csv: { path: "export.csv", file: "coletas.csv" },
    xlsx: { path: "export.xlsx", file: "coletas.xlsx" },
    json: { path: "export.json", file: "coletas.json" },
    pdf: { path: "report.pdf", file: "relatorio.pdf" },
};

/** Baixa o arquivo (CSV, Excel, JSON ou PDF do relatório) com os mesmos filtros da tela. */
export const downloadResearchExport = async (researchId: number, kind: ExportKind, filters: ReportFilters = {}): Promise<void> => {
    const { path, file } = EXPORT_PATH[kind];
    const response = await apiFetch(`/research/${researchId}/${path}${reportQueryString(filters)}`, { method: "GET", credentials: "include" });
    if (!response.ok) throw await readError(response, "Falha ao exportar");

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pesquisa-${researchId}-${file}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ---------- auditoria de qualidade e mapa ----------

export type QualityCode = "TOO_FAST" | "OUT_OF_AREA" | "NO_LOCATION" | "REPEATED_ANSWERS" | "MISSING_AUDIO";

export const QUALITY_LABELS: Record<QualityCode, string> = {
    TOO_FAST: "Coleta muito rápida",
    OUT_OF_AREA: "Fora da área-alvo",
    NO_LOCATION: "Sem localização",
    REPEATED_ANSWERS: "Respostas repetidas",
    MISSING_AUDIO: "Áudio ausente",
};

export interface QualityFlag {
    code: QualityCode;
    severity: "warning" | "info";
    message: string;
}

export interface TargetArea {
    latitude: number;
    longitude: number;
    radiusKm: number;
}

export interface ResearchQuality {
    area: TargetArea | null;
    recordInterview: boolean;
    summary: {
        totalCollections: number;
        flaggedCollections: number;
        collectionsWithWarning: number;
        byCode: Record<QualityCode, number>;
        flaggedByResearcher: { researcherId: number; flagged: number; name: string }[];
    };
    items: {
        collectionId: number;
        researcherId: number;
        researcherName: string;
        startedAt: string;
        durationSeconds: number | null;
        flags: QualityFlag[];
    }[];
}

export const getResearchQuality = async (researchId: number, filters: ReportFilters = {}): Promise<ResearchQuality> => {
    const response = await apiFetch(`/research/${researchId}/quality${reportQueryString(filters)}`, { method: "GET", credentials: "include" });
    if (!response.ok) throw await readError(response, "Falha ao carregar a auditoria de qualidade");
    return response.json();
};

export interface MapPoint {
    collectionId: number;
    researcherId: number;
    researcherName: string;
    latitude: number;
    longitude: number;
    accuracy: number | null;
    startedAt: string;
    finishedAt: string;
    durationSeconds: number | null;
    flags: QualityFlag[];
}

export interface ResearchMap {
    area: TargetArea | null;
    totalCollections: number;
    withLocation: number;
    withoutLocation: number;
    researchers: { userId: number; name: string }[];
    points: MapPoint[];
}

export const getResearchMap = async (researchId: number, filters: ReportFilters = {}): Promise<ResearchMap> => {
    const response = await apiFetch(`/research/${researchId}/map${reportQueryString(filters)}`, { method: "GET", credentials: "include" });
    if (!response.ok) throw await readError(response, "Falha ao carregar o mapa");
    return response.json();
};

/** Encerra a pesquisa: bloqueia coleta nova e congela o resultado. Não tem volta. */
export const closeResearch = async (researchId: number): Promise<void> => {
    const response = await apiFetch(`/research/${researchId}/close`, { method: "POST", credentials: "include", body: JSON.stringify({}) });
    if (!response.ok) throw await readError(response, "Falha ao encerrar a pesquisa");
};

export const formatSeconds = (seconds: number | null): string => {
    if (seconds === null) return "-";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`;
    return m > 0 ? `${m}min ${String(s).padStart(2, "0")}s` : `${s}s`;
};

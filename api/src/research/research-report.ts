// W12 — painel, relatório e exportação: cálculo puro, sem banco. O serviço carrega os dados (já
// restritos à empresa de quem está logado) e entrega tudo para cá.

export interface ReportCollection {
    id: number;
    researcherId: number;
    startedAt: string;
    finishedAt: string;
    receivedAt: string;
    // Local de início (GPS), áudio da entrevista e consentimento: usados no mapa e na auditoria de qualidade.
    startLatitude?: number | null;
    startLongitude?: number | null;
    locationAccuracy?: number | null;
    audioPath?: string | null;
    consentGiven?: boolean;
}

export interface ReportAnswer {
    collectionId: number | null;
    questionId: number;
    value: string;
    id: number;
}

export interface ReportQuestion {
    id: number;
    statement: string;
    type: string;
    sectionOrder: number;
    order: number;
    options: { id: number; text: string; order: number }[];
}

export interface ReportResearcher {
    userId: number;
    name: string;
    username: string | null;
    avatarUrl?: string | null;
    targetCount: number | null;
    linked: boolean;
    lastSyncAt: string | null;
}

export interface ReportFilter {
    /** Início do período (inclusivo), em ISO. */
    from?: Date;
    /** Fim do período (inclusivo), em ISO. */
    to?: Date;
    researcherId?: number;
}

/** Tipos que viram gráfico: escolha única, múltipla escolha e sim/não. */
export const CHART_TYPES = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'YES_NO'] as const;

export const time = (iso: string) => new Date(iso).getTime();

/** Período e pesquisador, aplicados da mesma forma ao painel, ao relatório e à exportação. O período vale pelo INÍCIO da coleta. */
export function filterCollections<T extends ReportCollection>(collections: T[], filter: ReportFilter): T[] {
    return collections.filter((c) => {
        if (filter.researcherId !== undefined && c.researcherId !== filter.researcherId) return false;
        const started = time(c.startedAt);
        if (filter.from && started < filter.from.getTime()) return false;
        if (filter.to && started > filter.to.getTime()) return false;
        return true;
    });
}

/** Duração da coleta, do início ao fim, em segundos. Datas inválidas ou fim antes do início não entram na conta. */
export function durationSeconds(c: Pick<ReportCollection, 'startedAt' | 'finishedAt'>): number | null {
    const seconds = (time(c.finishedAt) - time(c.startedAt)) / 1000;
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function averageDuration(collections: ReportCollection[]): number | null {
    const values = collections.map(durationSeconds).filter((v): v is number => v !== null);
    if (values.length === 0) return null;
    return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

// Pesquisador com média abaixo desta fração da média da equipe (e coletas suficientes) é sinalizado.
const FAST_RATIO = 0.5;
const FAST_MIN_COLLECTIONS = 3;

function isFast(own: number | null, collected: number, others: number | null): boolean {
    return own !== null && others !== null && collected >= FAST_MIN_COLLECTIONS && own < others * FAST_RATIO;
}

export function buildPanel(researchers: ReportResearcher[], collections: ReportCollection[]) {
    const byResearcher = new Map<number, ReportCollection[]>();
    for (const c of collections) {
        const list = byResearcher.get(c.researcherId) ?? [];
        list.push(c);
        byResearcher.set(c.researcherId, list);
    }

    const teamAverage = averageDuration(collections);

    const rows = researchers.map((r) => {
        const own = byResearcher.get(r.userId) ?? [];
        const collected = own.length;
        const averageSeconds = averageDuration(own);
        const lastCollectionAt = own.reduce<string | null>(
            (latest, c) => (latest === null || time(c.receivedAt) > time(latest) ? c.receivedAt : latest),
            null,
        );
        return {
            userId: r.userId,
            name: r.name,
            username: r.username,
            avatarUrl: r.avatarUrl ?? null,
            linked: r.linked,
            targetCount: r.targetCount,
            collected,
            progress: r.targetCount ? Math.min(100, Math.round((collected / r.targetCount) * 100)) : null,
            lastSyncAt: r.lastSyncAt,
            lastCollectionAt,
            averageSeconds,
            // Média muito abaixo da dos colegas: o questionário respondido em quatro minutos no estacionamento.
            // O parâmetro são os OUTROS pesquisadores, para quem corre não puxar a própria régua para baixo.
            suspiciouslyFast: isFast(averageSeconds, collected, averageDuration(collections.filter((c) => c.researcherId !== r.userId))),
        };
    });

    rows.sort((a, b) => b.collected - a.collected || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));

    // Meta da pesquisa = soma das metas; só conta para ela quem tem meta (cada um limitado à própria meta,
    // para quem passou da meta não esconder quem ficou devendo).
    const targeted = rows.filter((r) => r.targetCount);
    const targetTotal = targeted.reduce((sum, r) => sum + (r.targetCount ?? 0), 0);
    const towardTarget = targeted.reduce((sum, r) => sum + Math.min(r.collected, r.targetCount ?? 0), 0);

    const syncs = rows.map((r) => r.lastSyncAt).filter((v): v is string => !!v);
    const lastSyncAt = syncs.reduce<string | null>((latest, v) => (latest === null || time(v) > time(latest) ? v : latest), null);

    return {
        totalCollections: collections.length,
        targetTotal: targetTotal || null,
        goalPercent: targetTotal ? Math.round((towardTarget / targetTotal) * 100) : null,
        averageSeconds: teamAverage,
        lastSyncAt,
        researchers: rows,
    };
}

// ---------- gráficos por questão ----------

const YES_NO_LABEL: Record<string, string> = { YES: 'Sim', NO: 'Não' };

function parseIds(raw: string): string[] {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String) : [String(raw)];
    } catch {
        return [String(raw)];
    }
}

/** A resposta de cada coleta: se a questão aparece mais de uma vez na mesma coleta, vale a última gravada. */
export function latestAnswers(answers: ReportAnswer[], collectionIds: Set<number>): Map<string, string> {
    const sorted = [...answers].sort((a, b) => a.id - b.id);
    const latest = new Map<string, string>();
    for (const a of sorted) {
        if (a.collectionId === null || !collectionIds.has(a.collectionId)) continue;
        latest.set(`${a.collectionId}:${a.questionId}`, a.value);
    }
    return latest;
}

export function buildCharts(questions: ReportQuestion[], collections: ReportCollection[], answers: ReportAnswer[]) {
    const collectionIds = new Set(collections.map((c) => c.id));
    const latest = latestAnswers(answers, collectionIds);

    return questions
        .filter((q) => (CHART_TYPES as readonly string[]).includes(q.type))
        .sort((a, b) => a.sectionOrder - b.sectionOrder || a.order - b.order)
        .map((q) => {
            const counts = new Map<string, number>();
            const labels = new Map<string, string>();

            if (q.type === 'YES_NO') {
                for (const key of ['YES', 'NO']) {
                    counts.set(key, 0);
                    labels.set(key, YES_NO_LABEL[key]);
                }
            } else {
                for (const o of [...q.options].sort((a, b) => a.order - b.order)) {
                    counts.set(String(o.id), 0);
                    labels.set(String(o.id), o.text);
                }
            }

            let answered = 0;
            for (const c of collections) {
                const raw = latest.get(`${c.id}:${q.id}`);
                if (raw === undefined || raw.trim() === '') continue;
                answered += 1;
                const keys = q.type === 'MULTIPLE_CHOICE' ? parseIds(raw) : [raw];
                for (const key of new Set(keys)) {
                    if (!counts.has(key)) {
                        // opção apagada depois da coleta: continua aparecendo, para o total fechar.
                        counts.set(key, 0);
                        labels.set(key, q.type === 'YES_NO' ? key : `Opção ${key}`);
                    }
                    counts.set(key, (counts.get(key) ?? 0) + 1);
                }
            }

            const totalSelections = [...counts.values()].reduce((sum, v) => sum + v, 0);
            return {
                questionId: q.id,
                statement: q.statement,
                type: q.type,
                answered,
                totalCollections: collections.length,
                // Em múltipla escolha a pessoa marca mais de uma: o percentual é sobre quem respondeu a questão.
                data: [...counts.entries()].map(([key, count]) => ({
                    key,
                    label: labels.get(key) ?? key,
                    count,
                    percent:
                        q.type === 'MULTIPLE_CHOICE'
                            ? answered
                                ? Math.round((count / answered) * 1000) / 10
                                : 0
                            : totalSelections
                              ? Math.round((count / totalSelections) * 1000) / 10
                              : 0,
                })),
            };
        });
}

// ---------- CSV ----------

// Ponto e vírgula e BOM: é o que o Excel em português abre direto, com acentos e uma coluna por campo.
export const CSV_SEPARATOR = ';';
export const CSV_BOM = '﻿';

/** Escapa a célula e neutraliza fórmula (=, +, -, @): resposta digitada em campo livre não pode virar comando na planilha. */
export function csvCell(value: unknown): string {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /["\n\r;,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface CsvResearcherName {
    userId: number;
    name: string;
}

export function formatAnswerForCsv(q: ReportQuestion, raw: string | undefined): string {
    if (raw === undefined || raw.trim() === '') return '';
    const optionText = (id: string) => q.options.find((o) => String(o.id) === id)?.text ?? id;

    switch (q.type) {
        case 'YES_NO':
            return YES_NO_LABEL[raw] ?? raw;
        case 'SINGLE_CHOICE':
            return optionText(raw);
        case 'MULTIPLE_CHOICE':
            return parseIds(raw).map(optionText).join(' | ');
        case 'LOCATION': {
            try {
                const p = JSON.parse(raw);
                if (typeof p?.latitude === 'number' && typeof p?.longitude === 'number') return `${p.latitude}, ${p.longitude}`;
            } catch {
                /* devolve o valor bruto */
            }
            return raw;
        }
        case 'MULTIPLE_PHOTOS':
            return parseIds(raw).join(' | ');
        default:
            return raw;
    }
}

/** Uma linha por coleta, uma coluna por questão (na ordem do questionário). */
export function buildCsv(
    questions: ReportQuestion[],
    collections: ReportCollection[],
    answers: ReportAnswer[],
    names: Map<number, string>,
): string {
    const ordered = [...questions].sort((a, b) => a.sectionOrder - b.sectionOrder || a.order - b.order);
    const latest = latestAnswers(answers, new Set(collections.map((c) => c.id)));

    const header = ['Coleta', 'Pesquisador', 'Início', 'Fim', 'Duração (segundos)', 'Recebida em', ...ordered.map((q) => q.statement)];
    const lines = [header.map(csvCell).join(CSV_SEPARATOR)];

    const sorted = [...collections].sort((a, b) => time(a.startedAt) - time(b.startedAt) || a.id - b.id);
    for (const c of sorted) {
        const row = [
            c.id,
            names.get(c.researcherId) ?? '',
            c.startedAt,
            c.finishedAt,
            durationSeconds(c) ?? '',
            c.receivedAt,
            ...ordered.map((q) => formatAnswerForCsv(q, latest.get(`${c.id}:${q.id}`))),
        ];
        lines.push(row.map(csvCell).join(CSV_SEPARATOR));
    }

    return CSV_BOM + lines.join('\r\n') + '\r\n';
}

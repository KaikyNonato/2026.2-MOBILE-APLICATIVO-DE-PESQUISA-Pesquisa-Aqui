// Auditoria de qualidade das coletas: cálculo puro, sem banco. Procura sinais de coleta feita às pressas,
// fora do local combinado, com respostas "no automático" ou sem o áudio que a pesquisa exige.
// São ALERTAS para o administrador conferir, não uma prova de fraude: nada é apagado nem bloqueado.

import {
    durationSeconds,
    latestAnswers,
    type ReportAnswer,
    type ReportCollection,
    type ReportQuestion,
} from './research-report.js';

export type QualityCode = 'TOO_FAST' | 'OUT_OF_AREA' | 'NO_LOCATION' | 'REPEATED_ANSWERS' | 'MISSING_AUDIO';

export interface QualityFlag {
    code: QualityCode;
    severity: 'warning' | 'info';
    message: string;
}

export interface TargetArea {
    latitude: number;
    longitude: number;
    radiusKm: number;
}

export interface QualityOptions {
    /** Pesquisa que grava a entrevista: coleta com consentimento e sem áudio é alertada. */
    recordInterview: boolean;
    area: TargetArea | null;
}

// Limites (ajustáveis aqui, em um lugar só).
export const QUALITY_LIMITS = {
    /** Segundos mínimos por questão respondida; abaixo disso a coleta é "muito rápida". */
    minSecondsPerAnswer: 2,
    /** Piso absoluto da duração, em segundos, para coletas com poucas respostas. */
    minTotalSeconds: 10,
    /** Duração abaixo desta fração da mediana das coletas da pesquisa também é alertada... */
    medianRatio: 0.35,
    /** ...mas só quando há coletas suficientes para a mediana significar algo. */
    medianMinCollections: 5,
    /** Quantas respostas de escolha/escala seguidas e iguais fazem o alerta. */
    choiceRun: 6,
    /** Quantos textos livres seguidos e idênticos fazem o alerta. */
    textRun: 3,
} as const;

const CHOICE_TYPES = ['SINGLE_CHOICE', 'SCALE_1_5', 'YES_NO'];

const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Distância entre dois pontos da Terra, em km (fórmula de haversine). */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
    const dLat = rad(bLat - aLat);
    const dLng = rad(bLng - aLng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Maior sequência de valores iguais e seguidos. */
function longestRun(values: string[]): number {
    let best = 0;
    let current = 0;
    for (let i = 0; i < values.length; i++) {
        current = i > 0 && values[i] === values[i - 1] ? current + 1 : 1;
        best = Math.max(best, current);
    }
    return best;
}

const fmtSeconds = (seconds: number) =>
    seconds >= 60 ? `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s` : `${Math.round(seconds)} s`;

export interface QualityItem {
    collectionId: number;
    flags: QualityFlag[];
}

/** Alertas de cada coleta (só as que têm algum alerta entram na lista). */
export function auditCollections(
    questions: ReportQuestion[],
    collections: ReportCollection[],
    answers: ReportAnswer[],
    options: QualityOptions,
): QualityItem[] {
    const ordered = [...questions].sort((a, b) => a.sectionOrder - b.sectionOrder || a.order - b.order);
    const latest = latestAnswers(answers, new Set(collections.map((c) => c.id)));
    const durations = collections.map(durationSeconds).filter((d): d is number => d !== null);
    const medianSeconds = durations.length >= QUALITY_LIMITS.medianMinCollections ? median(durations) : null;

    const items: QualityItem[] = [];

    for (const c of collections) {
        const flags: QualityFlag[] = [];
        const answered = ordered.filter((q) => (latest.get(`${c.id}:${q.id}`) ?? '').trim() !== '');

        // 1. Muito rápida
        const seconds = durationSeconds(c);
        if (seconds !== null) {
            const floor = Math.max(QUALITY_LIMITS.minTotalSeconds, answered.length * QUALITY_LIMITS.minSecondsPerAnswer);
            if (seconds < floor) {
                flags.push({
                    code: 'TOO_FAST',
                    severity: 'warning',
                    message: `Coleta muito rápida: ${fmtSeconds(seconds)} para ${answered.length} resposta(s) (esperado pelo menos ${fmtSeconds(floor)}).`,
                });
            } else if (medianSeconds !== null && seconds < medianSeconds * QUALITY_LIMITS.medianRatio) {
                flags.push({
                    code: 'TOO_FAST',
                    severity: 'warning',
                    message: `Coleta muito mais rápida que o normal: ${fmtSeconds(seconds)}, contra ${fmtSeconds(medianSeconds)} de mediana na pesquisa.`,
                });
            }
        }

        // 2. Fora da área-alvo / sem localização
        if (options.area) {
            const hasLocation = typeof c.startLatitude === 'number' && typeof c.startLongitude === 'number';
            if (!hasLocation) {
                flags.push({
                    code: 'NO_LOCATION',
                    severity: 'info',
                    message: 'Sem localização registrada: não dá para conferir se a entrevista foi na área-alvo.',
                });
            } else {
                const km = distanceKm(options.area.latitude, options.area.longitude, c.startLatitude!, c.startLongitude!);
                if (km > options.area.radiusKm) {
                    flags.push({
                        code: 'OUT_OF_AREA',
                        severity: 'warning',
                        message: `Entrevista iniciada a ${km.toFixed(1)} km do centro da área-alvo (raio de ${options.area.radiusKm} km).`,
                    });
                }
            }
        }

        // 3. Respostas repetidas em sequência
        const choiceValues = answered.filter((q) => CHOICE_TYPES.includes(q.type)).map((q) => (latest.get(`${c.id}:${q.id}`) ?? '').trim());
        const textValues = answered.filter((q) => q.type === 'FREE_TEXT').map((q) => (latest.get(`${c.id}:${q.id}`) ?? '').trim().toLowerCase());
        const choiceRun = longestRun(choiceValues);
        const textRun = longestRun(textValues);
        if (choiceRun >= QUALITY_LIMITS.choiceRun) {
            flags.push({
                code: 'REPEATED_ANSWERS',
                severity: 'warning',
                message: `${choiceRun} respostas de escolha seguidas com o mesmo valor (possível preenchimento automático).`,
            });
        } else if (textRun >= QUALITY_LIMITS.textRun) {
            flags.push({
                code: 'REPEATED_ANSWERS',
                severity: 'warning',
                message: `${textRun} respostas de texto seguidas e idênticas.`,
            });
        }

        // 4. Áudio ausente
        if (options.recordInterview && c.consentGiven && !c.audioPath) {
            flags.push({
                code: 'MISSING_AUDIO',
                severity: 'warning',
                message: 'A pesquisa grava a entrevista e houve consentimento, mas o áudio não chegou.',
            });
        }

        if (flags.length > 0) items.push({ collectionId: c.id, flags });
    }

    return items;
}

export const QUALITY_LABELS: Record<QualityCode, string> = {
    TOO_FAST: 'Coleta muito rápida',
    OUT_OF_AREA: 'Fora da área-alvo',
    NO_LOCATION: 'Sem localização',
    REPEATED_ANSWERS: 'Respostas repetidas',
    MISSING_AUDIO: 'Áudio ausente',
};

/** Totais por tipo de alerta e por pesquisador. */
export function summarizeQuality(items: QualityItem[], collections: ReportCollection[]) {
    const byCode: Record<QualityCode, number> = { TOO_FAST: 0, OUT_OF_AREA: 0, NO_LOCATION: 0, REPEATED_ANSWERS: 0, MISSING_AUDIO: 0 };
    const researcherOf = new Map(collections.map((c) => [c.id, c.researcherId]));
    const flaggedByResearcher = new Map<number, number>();
    let withWarning = 0;

    for (const item of items) {
        for (const flag of item.flags) byCode[flag.code] += 1;
        if (item.flags.some((f) => f.severity === 'warning')) {
            withWarning += 1;
            const researcherId = researcherOf.get(item.collectionId);
            if (researcherId !== undefined) flaggedByResearcher.set(researcherId, (flaggedByResearcher.get(researcherId) ?? 0) + 1);
        }
    }

    return {
        totalCollections: collections.length,
        flaggedCollections: items.length,
        collectionsWithWarning: withWarning,
        byCode,
        flaggedByResearcher: [...flaggedByResearcher.entries()].map(([researcherId, flagged]) => ({ researcherId, flagged })),
    };
}

import type { LocalCollection } from './collectionStore';
import type { SentRecord } from './sentHistory';

// Cálculos do modo campo: distância, área-alvo e a lista de entrevistas do dia. Tudo no aparelho, sem internet.

export interface Coordinate {
    latitude: number;
    longitude: number;
}

const EARTH_RADIUS_M = 6_371_000;
/** Converte graus em radianos. */
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Distância em metros entre duas coordenadas (fórmula de Haversine). */
export function distanceMeters(a: Coordinate, b: Coordinate): number {
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface TargetArea {
    center: Coordinate;
    radiusMeters: number;
}

/** Área-alvo da pesquisa, ou null quando ela não tem (ou veio incompleta). */
export function getTargetArea(research: {
    areaLatitude?: number | null;
    areaLongitude?: number | null;
    areaRadiusKm?: number | null;
}): TargetArea | null {
    const { areaLatitude, areaLongitude, areaRadiusKm } = research;
    if (
        typeof areaLatitude !== 'number' ||
        typeof areaLongitude !== 'number' ||
        typeof areaRadiusKm !== 'number' ||
        !Number.isFinite(areaLatitude + areaLongitude + areaRadiusKm) ||
        areaRadiusKm <= 0
    ) {
        return null;
    }
    return { center: { latitude: areaLatitude, longitude: areaLongitude }, radiusMeters: areaRadiusKm * 1000 };
}

/** Distância da posição até a borda da área; 0 se estiver dentro. */
export function distanceOutsideArea(position: Coordinate, area: TargetArea): number {
    return Math.max(0, distanceMeters(position, area.center) - area.radiusMeters);
}

/** Diz se a data ISO cai no mesmo dia local de `now`. */
export const isSameLocalDay = (iso: string, now: Date): boolean => {
    const date = new Date(iso);
    return (
        !Number.isNaN(date.getTime()) &&
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
    );
};

export type DayEntryStatus = 'DRAFT' | 'PENDING' | 'SENT';

export interface DayEntry {
    clientId: string;
    researchId: number;
    status: DayEntryStatus;
    startedAt: string;
    durationMinutes: number | null;
    position: Coordinate | null;
}

/** Minutos entre dois instantes (no mínimo 1). Devolve `null` se faltar o fim ou se for negativo. */
const minutesBetween = (start: string, end?: string): number | null => {
    if (!end) return null;
    const diff = new Date(end).getTime() - new Date(start).getTime();
    return Number.isFinite(diff) && diff >= 0 ? Math.max(1, Math.round(diff / 60000)) : null;
};

/**
 * Entrevistas de hoje de uma pesquisa, da mais recente para a mais antiga: rascunhos, finalizadas
 * aguardando envio e as já enviadas (estas vêm do histórico, que não guarda a posição).
 */
export function buildDayEntries(
    researchId: number,
    collections: LocalCollection[],
    sent: SentRecord[],
    now: Date = new Date(),
): DayEntry[] {
    const entries: DayEntry[] = [];
    const seen = new Set<string>();

    for (const c of collections) {
        if (c.researchId !== researchId || !isSameLocalDay(c.startedAt, now)) continue;
        seen.add(c.clientId.toLowerCase());
        entries.push({
            clientId: c.clientId,
            researchId,
            status: c.status === 'FINISHED' ? 'PENDING' : 'DRAFT',
            startedAt: c.startedAt,
            durationMinutes: minutesBetween(c.startedAt, c.finishedAt),
            position: c.startLocation
                ? { latitude: c.startLocation.latitude, longitude: c.startLocation.longitude }
                : null,
        });
    }

    for (const record of sent) {
        if (record.researchId !== researchId || !isSameLocalDay(record.startedAt, now)) continue;
        if (seen.has(record.clientId.toLowerCase())) continue;
        entries.push({
            clientId: record.clientId,
            researchId,
            status: 'SENT',
            startedAt: record.startedAt,
            durationMinutes: minutesBetween(record.startedAt, record.finishedAt),
            position: null,
        });
    }

    return entries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** '850 m' ou '2,4 km'. */
export function formatDistance(meters: number): { unit: 'm' | 'km'; value: string } {
    if (meters < 1000) return { unit: 'm', value: String(Math.round(meters)) };
    return { unit: 'km', value: (meters / 1000).toFixed(1).replace('.', ',') };
}

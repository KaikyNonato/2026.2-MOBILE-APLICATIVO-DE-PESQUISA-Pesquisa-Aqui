import type { LocalCollection } from '@/lib/collectionStore';
import { parseApiDate } from '@/lib/formatDate';
import type { SentRecord } from '@/lib/sentHistory';

export const MESES = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export interface DayStat {
    key: string;
    label: string;
    count: number;
    isToday: boolean;
}

export interface HomeStats {
    month: number;
    lastMonth: number;
    today: number;
    last7: number;
    /** Os 7 dias até hoje, do mais antigo ao mais recente. */
    days: DayStat[];
}

/** Chave do dia (ano-mês-dia), para comparar datas. */
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Saudação conforme a hora do dia (bom dia, boa tarde...). */
export function greeting(now = new Date()): string {
    const h = now.getHours();
    if (h < 5) return 'Boa madrugada';
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
}

/** Data por extenso (dia da semana, dia e mês), com a inicial maiúscula. */
export function formatLongDate(now = new Date()): string {
    const text = `${DIAS[now.getDay()]}, ${now.getDate()} de ${MESES[now.getMonth()]}`;
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Coletas concluídas: as finalizadas ainda no aparelho (aguardando envio) + as já enviadas (histórico).
 * Pelo clientId, uma coleta nunca conta duas vezes.
 */
export function computeStats(finished: LocalCollection[], sent: SentRecord[], now = new Date()): HomeStats {
    const done = new Map<string, Date>();
    const add = (clientId: string, iso?: string) => {
        const date = parseApiDate(iso);
        if (date) done.set(clientId, date);
    };
    sent.forEach((r) => add(r.clientId, r.finishedAt ?? r.startedAt));
    finished.forEach((c) => add(c.clientId, c.finishedAt ?? c.startedAt));

    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const perDay = new Map<string, number>();
    let month = 0;
    let lastMonth = 0;
    done.forEach((date) => {
        if (date.getFullYear() === thisMonth.getFullYear() && date.getMonth() === thisMonth.getMonth()) month++;
        if (date.getFullYear() === prevMonth.getFullYear() && date.getMonth() === prevMonth.getMonth()) lastMonth++;
        const key = dayKey(date);
        perDay.set(key, (perDay.get(key) ?? 0) + 1);
    });

    const days: DayStat[] = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const key = dayKey(date);
        days.push({ key, label: LETRAS[date.getDay()], count: perDay.get(key) ?? 0, isToday: i === 0 });
    }

    return {
        month,
        lastMonth,
        today: days[6].count,
        last7: days.reduce((sum, d) => sum + d.count, 0),
        days,
    };
}

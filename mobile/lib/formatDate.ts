/**
 * Datas que vêm da API (vigência da pesquisa). O Hermes (motor JS do app) é bem mais exigente que o
 * navegador
 * para ler datas: formatos do Postgres como "2026-10-27 15:00:00.123456+00" viram "Invalid Date" e
 * a tela
 * mostrava "-". Aqui o texto é normalizado para ISO 8601 antes de ler.
 */
export function parseApiDate(value?: string | number | Date | null): Date | null {
    if (value === undefined || value === null || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const text = value.trim();

    // Só a data (sem horário): vale o dia do calendário, sem deslocar pelo fuso.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (dateOnly) {
        const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const iso = text
        .replace(' ', 'T') // "2026-10-27 15:00:00" -> "2026-10-27T15:00:00"
        .replace(/(\.\d{3})\d+/, '$1') // microssegundos -> milissegundos
        .replace(/([+-]\d{2})$/, '$1:00') // "+00" -> "+00:00"
        .replace(/([+-]\d{2})(\d{2})$/, '$1:$2'); // "+0000" -> "+00:00"
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** dd/mm/aaaa, ou "-" quando a data não pôde ser lida. */
export function formatApiDate(value?: string | number | Date | null): string {
    const date = parseApiDate(value);
    return date ? date.toLocaleDateString('pt-BR') : '-';
}

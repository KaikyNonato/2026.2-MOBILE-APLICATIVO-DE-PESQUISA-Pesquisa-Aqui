import { MONTH_NAMES } from "@/lib/dashboard";

/** "Bom dia", "Boa tarde" ou "Boa noite", conforme a hora local. */
export function greetingFor(date = new Date()): string {
    const hour = date.getHours();
    if (hour < 12) return "Bom dia";
    if (hour < 18) return "Boa tarde";
    return "Boa noite";
}

/** Primeiro nome de uma pessoa. */
export function firstName(name?: string): string {
    return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Ex.: "Segunda-feira, 19 de outubro" */
export function todayLabel(date = new Date()): string {
    const text = date.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Nome do mês em minúsculas, a partir do índice (aceita valores fora de 0 a 11). */
export const monthName = (monthIndex: number) => MONTH_NAMES[((monthIndex % 12) + 12) % 12].toLowerCase();

/** Posições fixas dos pontos de campo sobre as curvas de nível do hero. */
export const PIN_SLOTS = [
    { left: "34%", top: "62%", delay: "0s" },
    { left: "62%", top: "36%", delay: "0.9s" },
    { left: "48%", top: "18%", delay: "1.6s" },
    { left: "74%", top: "72%", delay: "2.2s" },
] as const;

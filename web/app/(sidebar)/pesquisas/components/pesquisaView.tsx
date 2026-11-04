import { UserAvatar } from "@/components/ui/user-avatar";
import { avatarTone, daysUntilEnd, parseCalendarDate, periodProgress } from "@/lib/fieldData";
import type { Research } from "@/lib/research";
import type { UserItem } from "@/lib/user";
import { situationOf } from "../../(home)/components/PesquisasEquipeTabela";

/** Peças e regras compartilhadas pelo calendário de campo, pelos cartões e pela lista de pesquisas. */

export type Filter = "ALL" | Research["status"];

export type PesquisaItemProps = {
    research: Research;
    team: UserItem[];
    collections: number;
    /** Equipe e coletas ainda não chegaram (ou o perfil não tem acesso a elas). */
    teamLoading?: boolean;
    now: number;
    onPublish: (id: number) => void;
    onUnpublish: (id: number) => void;
    onDelete: (id: number) => void;
    onUpdated: (updated: Research) => void;
};

const DAY_MS = 86_400_000;
const MAX_AVATARS = 3;
/** Faltando até este número de dias, a trilha ganha o tom de argila ("prazo perto"). */
const SOON_DAYS = 14;

/** Completa o número com zero à esquerda (2 dígitos). */
const pad = (n: number) => String(n).padStart(2, "0");
/** Escolhe entre o singular e o plural conforme o número. */
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** Formata o número com uma casa decimal e vírgula. */
const dec = (n: number) => n.toFixed(1).replace(".", ",");

/** Número do dia (independe de fuso e de horário de verão). */
export const dayIndex = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);

/** "06/08" (com o ano quando não é o ano atual). */
function formatDay(raw: string | undefined, now: number): string {
    const d = parseCalendarDate(raw);
    if (!d) return "—";
    const year = d.getFullYear() === new Date(now).getFullYear() ? "" : `/${d.getFullYear()}`;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}${year}`;
}

/* ------------------------------------------------------------------
   Aparência de cada pesquisa
   ------------------------------------------------------------------ */

export type PesquisaKind = "live" | "draft" | "closed";

export interface PesquisaView {
    /** Visual: em campo (verde), rascunho (argila) ou encerrada (cinza). */
    kind: PesquisaKind;
    /** Prazo perto: a trilha usa argila. */
    soon: boolean;
    chipLabel: string;
    chipClass: "pq-c-live" | "pq-c-clay" | "pq-c-gray";
    /** Quanto da trilha já passou, de 0 a 100. */
    done: number;
    startLabel: string;
    endLabel: string;
    note: string;
}

/**
 * Tudo o que o cartão e a lista mostram sobre uma pesquisa.
 * `collections` é null quando as coletas não estão disponíveis (a nota fica sem a média por dia).
 */
export function viewOf(research: Research, now: number, collections: number | null): PesquisaView {
    const situation = situationOf(research, now);
    const daysLeft = daysUntilEnd(research.endDate, now);
    const expired = research.status !== "DRAFT" && research.status !== "CLOSED" && daysLeft !== null && daysLeft < 0;

    const kind: PesquisaKind = research.status === "DRAFT" ? "draft" : research.status === "CLOSED" || expired ? "closed" : "live";
    const soon = kind === "live" && daysLeft !== null && daysLeft <= SOON_DAYS;

    const chipClass =
        kind === "draft" ? "pq-c-clay" : situation.tone === "clay" ? "pq-c-clay" : situation.tone === "gray" ? "pq-c-gray" : "pq-c-live";
    const done = kind === "closed" ? 100 : kind === "draft" ? 0 : Math.round(periodProgress(research, now) * 100);

    const startLabel = formatDay(research.startDate, now);
    const endLabel = formatDay(research.endDate, now);

    const start = parseCalendarDate(research.startDate);
    const end = parseCalendarDate(research.endDate);
    const today = dayIndex(new Date(now));
    let note: string;

    if (kind === "draft") {
        note = "Rascunho: publique para liberar no aplicativo";
    } else if (kind === "closed") {
        const label = research.status === "CLOSED" ? "Encerrada em" : "Prazo encerrado em";
        const span = start && end ? Math.max(1, dayIndex(end) - dayIndex(start)) : 0;
        note = `${label} ${endLabel}` + (collections !== null && span > 0 ? ` · ${dec(collections / span)} coletas por dia` : "");
    } else {
        const elapsed = start ? today - dayIndex(start) : 0;
        let lead: string;
        if (start && elapsed < 0) lead = `Começa em ${-elapsed} ${plural(-elapsed, "dia", "dias")}`;
        else if (elapsed >= 7 && collections !== null) lead = `${dec(collections / elapsed)} coletas por dia`;
        else if (elapsed === 0) lead = "Começou hoje";
        else lead = `Começou há ${elapsed} ${plural(elapsed, "dia", "dias")}`;

        const tail =
            daysLeft === null ? "" : daysLeft === 0 ? "encerra hoje" : `encerra em ${daysLeft} ${plural(daysLeft, "dia", "dias")}`;
        note = tail ? `${lead} · ${tail}` : lead;
    }

    return { kind, soon, chipLabel: situation.label, chipClass, done, startLabel, endLabel, note };
}

/* ------------------------------------------------------------------
   Calendário: eixo de meses e posição das trilhas
   ------------------------------------------------------------------ */

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export interface CalendarLayout {
    /** Cada mês do período: posição (%) e rótulo (vazio quando o rótulo não cabe). */
    months: { left: number; label: string }[];
    todayLeft: number;
    /** Posição e largura (%) da trilha de uma pesquisa; null se faltar data. */
    bar: (research: Research) => { left: number; width: number } | null;
}

/** Período exibido: do primeiro dia do mês da pesquisa mais antiga (ou de hoje) até o fim do mês da mais distante. */
export function buildCalendar(researches: Research[], now: number): CalendarLayout {
    const today = new Date(now);
    let min = today;
    let max = today;

    for (const r of researches) {
        const s = parseCalendarDate(r.startDate);
        const e = parseCalendarDate(r.endDate);
        if (s && s < min) min = s;
        if (e && e > max) max = e;
    }

    const first = new Date(min.getFullYear(), min.getMonth(), 1);
    const after = new Date(max.getFullYear(), max.getMonth() + 1, 1);
    const startIdx = dayIndex(first);
    const span = Math.max(1, dayIndex(after) - startIdx);
    const pct = (idx: number) => ((idx - startIdx) / span) * 100;

    const total = (after.getFullYear() - first.getFullYear()) * 12 + after.getMonth() - first.getMonth();
    const long = total > 12;
    const step = long ? Math.ceil(total / 12) : 1;

    const months = Array.from({ length: total }, (_, i) => {
        const d = new Date(first.getFullYear(), first.getMonth() + i, 1);
        const year = long && (i === 0 || d.getMonth() === 0) ? ` ${String(d.getFullYear()).slice(2)}` : "";
        return { left: pct(dayIndex(d)), label: i % step === 0 ? `${MONTHS[d.getMonth()]}${year}` : "" };
    });

    return {
        months,
        todayLeft: pct(dayIndex(today)),
        bar: (research) => {
            const s = parseCalendarDate(research.startDate);
            const e = parseCalendarDate(research.endDate);
            if (!s || !e) return null;
            const left = pct(dayIndex(s));
            return { left, width: Math.max(pct(dayIndex(e)) - left, 0.6) };
        },
    };
}

/* ------------------------------------------------------------------
   Peças visuais
   ------------------------------------------------------------------ */

/** Trilha do período: tracejado até o prazo, cheio até hoje, com o marcador no ponto atual. */
export function Trail({ kind, soon, done }: { kind: PesquisaKind; soon: boolean; done: number }) {
    return (
        <div className={`pq-trail ${kind}${soon ? " soon" : ""}`} role="img" aria-label={`${done}% do período decorrido`}>
            <i className="rest" />
            <i className="done" style={{ width: `${done}%` }} />
            <i className="pin" style={{ left: `${done}%` }} />
        </div>
    );
}

/** Pilha de avatares da equipe (ou "Sem equipe" / "–" enquanto carrega). */
export function TeamStack({ team, loading }: { team: UserItem[]; loading: boolean }) {
    if (loading) return <span className="pq-muted">–</span>;
    if (team.length === 0) return <span className="pq-muted">Sem equipe</span>;

    return (
        <div className="pa-stack" title={team.map((u) => u.name).join(", ")}>
            {team.slice(0, MAX_AVATARS).map((u) => (
                <UserAvatar key={u.id} name={u.name} src={u.avatarUrl} size={32} className={`avatar-pa ${avatarTone(u.id)}`} />
            ))}
            {team.length > MAX_AVATARS && <div className="avatar-pa more">+{team.length - MAX_AVATARS}</div>}
        </div>
    );
}

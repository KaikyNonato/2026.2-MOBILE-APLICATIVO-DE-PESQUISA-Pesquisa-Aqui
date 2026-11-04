'use client';

import BannerComponent from "@/components/ui/bannerComponent";
import { Button } from "@/components/ui/button";
import { Contour } from "@/components/ui/contour";
import { TableSearch } from "@/components/ui/data-table";
import { LoadingState } from "@/components/ui/loadingState";
import { isSessionExpiredError } from "@/lib/apiFetcher";
import {
    daysUntil,
    deadlineLabel,
    formatShortDate,
    getMyResearches,
    isOpenForCollection,
    MY_STATUS_LABELS,
    progressPercent,
    sortMyResearches,
    type MyResearch,
} from "@/lib/researcher";
import { CalendarClock, ChevronDown, Mic, SearchX, Smartphone, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Filter = "ALL" | "OPEN" | "CLOSED";

const FILTERS: { value: Filter; label: string }[] = [
    { value: "ALL", label: "Todas" },
    { value: "OPEN", label: "Em andamento" },
    { value: "CLOSED", label: "Encerradas" },
];

/** Texto sem acento e em minúsculas, para a busca. */
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const STATUS_STYLE: Record<MyResearch["status"], string> = {
    IN_FIELD: "bg-[rgba(68,119,98,0.14)] text-[var(--green-deep)]",
    PUBLISHED: "bg-[#e4ece7] text-[var(--green-deep)]",
    CLOSED: "bg-[#ebeeeb] text-[#5d6a63]",
    DRAFT: "bg-[#ebeeeb] text-[#5d6a63]",
};

/** Card de uma pesquisa do pesquisador, com prazo, progresso e se a coleta está aberta. */
function ResearchCard({ research, now, delay }: { research: MyResearch; now: number; delay: number }) {
    const open = isOpenForCollection(research);
    const days = daysUntil(research.endDate, now);
    const percent = progressPercent(research);

    return (
        <article style={{ animationDelay: `${delay * 60}ms` }} className="pa-card introduction-card flex flex-col gap-4 !p-5">
            <div className="flex items-start justify-between gap-3">
                <h3 className="min-w-0 break-words">{research.title}</h3>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[research.status]}`}>
                    {MY_STATUS_LABELS[research.status]}
                </span>
            </div>

            {research.description && <p className="line-clamp-3 text-sm text-[#3c4a42]">{research.description}</p>}

            <dl className="flex flex-col gap-2 text-[13px]">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <CalendarClock className="size-4 shrink-0" />
                    <dt className="sr-only">Período</dt>
                    <dd>
                        {formatShortDate(research.startDate)} a {formatShortDate(research.endDate)}
                        {open && (
                            <b className={`ml-1.5 font-medium ${days <= 7 ? "text-[#8a432f]" : "text-foreground"}`}>
                                · {deadlineLabel(days)}
                            </b>
                        )}
                    </dd>
                </div>
                {research.targetAudience && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Users className="size-4 shrink-0" />
                        <dt className="sr-only">Público-alvo</dt>
                        <dd className="min-w-0 truncate" title={research.targetAudience}>{research.targetAudience}</dd>
                    </div>
                )}
                {research.recordInterview && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Mic className="size-4 shrink-0" />
                        <dt className="sr-only">Gravação</dt>
                        <dd>Exige gravação da entrevista</dd>
                    </div>
                )}
            </dl>

            <div>
                <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                        {research.targetCount
                            ? `${research.collected} de ${research.targetCount} coletas`
                            : `${research.collected} ${research.collected === 1 ? "coleta enviada" : "coletas enviadas"} (sem meta)`}
                    </span>
                    {percent !== null && <b className="font-semibold text-foreground">{percent}%</b>}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#e7ece8]">
                    <div
                        className="h-full rounded-full bg-[var(--green)] transition-[width] duration-700"
                        style={{ width: `${percent ?? (research.collected > 0 ? 100 : 0)}%`, opacity: percent === null ? 0.35 : 1 }}
                    />
                </div>
            </div>

            {research.objective && (
                <details className="group border-t border-border pt-3 text-sm">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium [&::-webkit-details-marker]:hidden">
                        Objetivo da pesquisa
                        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="mt-2 text-[#3c4a42]">{research.objective}</p>
                </details>
            )}
        </article>
    );
}

/** Pesquisas do pesquisador: só leitura. Baixar a pesquisa e coletar é no aplicativo. */
export default function MinhasPesquisas() {
    const [researches, setResearches] = useState<MyResearch[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<Filter>("ALL");
    const [query, setQuery] = useState("");
    const [now] = useState(() => Date.now());

    useEffect(() => {
        let cancelled = false;
        getMyResearches()
            .then((list) => { if (!cancelled) setResearches(sortMyResearches(list)); })
            .catch((err) => {
                if (cancelled || isSessionExpiredError(err)) return;
                setError(err instanceof Error ? err.message : "Erro ao carregar as suas pesquisas");
            });
        return () => { cancelled = true; };
    }, []);

    const visible = useMemo(() => {
        const term = normalize(query.trim());

        return (researches ?? []).filter((r) => {
            if (filter === "OPEN" && !isOpenForCollection(r)) return false;
            if (filter === "CLOSED" && r.status !== "CLOSED") return false;
            if (!term) return true;
            return normalize(`${r.title} ${r.description} ${r.objective} ${r.targetAudience}`).includes(term);
        });
    }, [researches, filter, query]);

    const countOf = (value: Filter) =>
        (researches ?? []).filter((r) =>
            value === "ALL" ? true : value === "OPEN" ? isOpenForCollection(r) : r.status === "CLOSED",
        ).length;

    if (!researches && !error) return <LoadingState label="Carregando suas pesquisas..." shape="research-cards" />;

    return (
        <section className="flex flex-col gap-6">
            <BannerComponent
                title="Minhas pesquisas"
                description="As pesquisas em que você está vinculado. Para baixar e coletar, use o aplicativo."
            />

            {error && <p role="alert" className="text-sm text-destructive">Erro: {error}</p>}

            <div className="introduction-card flex flex-wrap items-center gap-3">
                <TableSearch
                    value={query}
                    onChange={setQuery}
                    placeholder="Buscar por título, objetivo ou público..."
                    label="Buscar pesquisas"
                />
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por situação">
                    {FILTERS.map(({ value, label }) => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={filter === value}
                            onClick={() => setFilter(value)}
                            className={`inline-flex h-9 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-colors ${filter === value
                                    ? "border-[var(--forest)] bg-[var(--forest)] text-[var(--mint)]"
                                    : "border-[#cdd5d0] bg-white hover:bg-[#e9ede9]"
                                }`}
                        >
                            {label}
                            <span className="opacity-70">{countOf(value)}</span>
                        </button>
                    ))}
                </div>
            </div>

            {visible.length === 0 ? (
                <div className="pq-empty">
                    <Contour seed={1.9} rings={9} cx={0.5} cy={0.5} size={1} width={600} height={260} />
                    {(researches?.length ?? 0) === 0 ? (
                        <>
                            <Smartphone aria-hidden="true" />
                            <b>Nenhuma pesquisa para você ainda</b>
                            Quando o administrador da empresa vincular você a uma pesquisa publicada, ela aparece aqui.
                        </>
                    ) : (
                        <>
                            <SearchX aria-hidden="true" />
                            <b>Nada encontrado</b>
                            Nenhuma pesquisa combina com a busca e a situação escolhidas.
                            <div className="pq-empty-act">
                                <Button variant="outline" size="sm" onClick={() => { setQuery(""); setFilter("ALL"); }}>
                                    Limpar filtros
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {visible.map((research, i) => (
                        <ResearchCard key={research.id} research={research} now={now} delay={Math.min(i, 8)} />
                    ))}
                </div>
            )}
        </section>
    );
}

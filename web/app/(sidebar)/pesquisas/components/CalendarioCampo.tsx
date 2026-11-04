'use client';

import { Contour } from "@/components/ui/contour";
import { LoadingState } from "@/components/ui/loadingState";
import type { Research } from "@/lib/research";
import Link from "next/link";
import { useMemo, useState } from "react";
import { buildCalendar, viewOf, type Filter } from "./pesquisaView";

export type LegendItem = {
    value: Filter;
    label: string;
    /** Tracejado do marcador: all (pontilhado), live, pub, draft (tracejado) ou closed. */
    kind: "all" | "live" | "pub" | "draft" | "closed";
    /** null enquanto carrega. */
    count: number | null;
};

type CalendarioCampoProps = {
    /** Pesquisas exibidas (já filtradas e ordenadas). */
    rows: Research[];
    /** Todas as pesquisas: definem o período do eixo, que não muda ao filtrar. */
    all: Research[];
    legend: LegendItem[];
    filter: Filter;
    onFilter: (value: Filter) => void;
    now: number;
    loading: boolean;
    /** researchId -> coletas. Só existe para o administrador. */
    collectionsByResearch: Map<number, number>;
    collectionsReady: boolean;
    totalCollections?: number;
};

/** Linhas mostradas antes do "Mostrar todas": mantém o calendário compacto com muitas pesquisas. */
const MAX_ROWS = 8;

/**
 * Calendário de campo: cada pesquisa é uma trilha da abertura ao prazo; a parte cheia já passou.
 * A legenda à esquerda também é o filtro de situação da página.
 */
export default function CalendarioCampo({
    rows,
    all,
    legend,
    filter,
    onFilter,
    now,
    loading,
    collectionsByResearch,
    collectionsReady,
    totalCollections,
}: CalendarioCampoProps) {
    const [expanded, setExpanded] = useState(false);
    const layout = useMemo(() => buildCalendar(all, now), [all, now]);

    const shown = expanded ? rows : rows.slice(0, MAX_ROWS);
    const today = new Date(now);
    const todayLabel = `hoje, ${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}`;

    return (
        <section className="pa-cal introduction-card" aria-label="Calendário de campo">
            <Contour seed={3.3} rings={14} cx={0.93} cy={0.5} size={1.5} width={1100} height={420} />

            <div className="pa-cal-in">
                <div className="rail">
                    <h2>Calendário de campo</h2>
                    <p className="sub">Cada trilha vai da abertura ao prazo. A parte cheia já passou.</p>

                    {legend.map((item) => (
                        <button
                            key={item.value}
                            type="button"
                            className={`lg${filter === item.value ? " on" : ""}`}
                            aria-pressed={filter === item.value}
                            onClick={() => onFilter(item.value)}
                        >
                            <span className={`sw ${item.kind}`} />
                            {item.label}
                            <em>{item.count ?? "–"}</em>
                        </button>
                    ))}

                    {collectionsReady && totalCollections !== undefined && (
                        <div className="total">
                            <b>{totalCollections}</b>
                            <span>{totalCollections === 1 ? "coleta recebida" : "coletas recebidas"}</span>
                        </div>
                    )}
                </div>

                {/* Celular: no lugar da linha do tempo (larga demais), uma agenda em lista, uma pesquisa por item */}
                <div className="pa-cal-m">
                    {loading ? (
                        <LoadingState label="Carregando calendário..." shape="inline" tone="dark" />
                    ) : rows.length === 0 ? (
                        <div className="tl-empty">Nenhuma pesquisa nesta situação.</div>
                    ) : (
                        <>
                            <ul>
                                {shown.map((research) => {
                                    const count = collectionsReady ? collectionsByResearch.get(research.id) ?? 0 : null;
                                    const view = viewOf(research, now, count);

                                    return (
                                        <li key={research.id}>
                                            <Link href={`/pesquisas/${research.id}`} className={`am ${view.kind}${view.soon ? " soon" : ""}`}>
                                                <span className="am-top">
                                                    <b>{research.title}</b>
                                                    {count !== null && <em>{count}<small>{count === 1 ? "coleta" : "coletas"}</small></em>}
                                                </span>
                                                <span className="am-trail" role="img" aria-label={`${view.done}% do período decorrido`}>
                                                    <i className="rest" />
                                                    <i className="done" style={{ width: `${view.done}%` }} />
                                                    <i className="pin" style={{ left: `${view.done}%` }} />
                                                </span>
                                                <span className="am-dates"><span>{view.startLabel}</span><span>{view.endLabel}</span></span>
                                                <span className="am-note">{view.note}</span>
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                            {rows.length > MAX_ROWS && (
                                <button type="button" className="tl-more" onClick={() => setExpanded((value) => !value)}>
                                    {expanded ? "Mostrar menos" : `Mostrar todas (${rows.length})`}
                                </button>
                            )}
                        </>
                    )}
                </div>

                <div className="tl">
                    <div className="tl-scroll">
                        <div className="tl-in">
                            {loading ? (
                                <LoadingState label="Carregando calendário..." shape="inline" tone="dark" />
                            ) : (
                                <>
                                    <div className="tl-axis" aria-hidden="true">
                                        {layout.months.map((m, i) => m.label && (
                                            <span key={i} style={{ left: `${m.left}%` }}>{m.label}</span>
                                        ))}
                                    </div>

                                    <div className="tl-plot">
                                        <div aria-hidden="true">
                                            {layout.months.map((m, i) => <i key={i} className="gl" style={{ left: `${m.left}%` }} />)}
                                        </div>
                                        <div className="today" style={{ left: `${layout.todayLeft}%` }} aria-hidden="true">
                                            <span>{todayLabel}</span>
                                        </div>

                                        {shown.map((research) => {
                                            const bar = layout.bar(research);
                                            const count = collectionsReady ? collectionsByResearch.get(research.id) ?? 0 : null;
                                            const view = viewOf(research, now, count);

                                            return (
                                                <div key={research.id} className="tl-row">
                                                    <Link href={`/pesquisas/${research.id}`} className="tl-name"><span>{research.title}</span></Link>
                                                    {bar && (
                                                        <div
                                                            className={`bar ${view.kind}${view.soon ? " soon" : ""}`}
                                                            style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                                                        >
                                                            <i className="rest" />
                                                            <i className="done" style={{ width: `${view.done}%` }} />
                                                            <i className="s" />
                                                            <i className="e" />
                                                            {count !== null && (
                                                                <span className="lab">{count}<small>{count === 1 ? "coleta" : "coletas"}</small></span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}

                                        {rows.length === 0 && <div className="tl-empty">Nenhuma pesquisa nesta situação.</div>}
                                    </div>

                                    {rows.length > MAX_ROWS && (
                                        <button type="button" className="tl-more" onClick={() => setExpanded((value) => !value)}>
                                            {expanded ? "Mostrar menos" : `Mostrar todas (${rows.length})`}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

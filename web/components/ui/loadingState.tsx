import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

// Padrão ÚNICO de carregamento do painel. Toda tela ou bloco que espera dados usa este componente:
// uma linha com spinner + texto ("Carregando X...") e, logo abaixo, um esqueleto (blocos cinza que
// pulsam) com o FORMATO do que vai aparecer, para a tela não "pular" quando os dados chegam.
//
// O visual é sempre o mesmo (mesma cor, mesma pulsação, mesma linha de texto); só o desenho muda,
// escolhido por `shape`:
//
//   list            lista de linhas com ícone, dois textos e um selo (empresas, administradores)
//   people          grade de cartões com avatar (pesquisadores)
//   team-cards      equipe de uma pesquisa: painel de progresso, filtros e cartões (aba Pesquisadores)
//   results-panel   aba Resultados: filtros, quatro indicadores e tabela por pesquisador
//   copies          aba Cópias em campo: faixa verde do questionário e cartão "Quem está com a pesquisa"
//   research-cards  grade de cartões de pesquisa (página Pesquisas)
//   table           tabela com cabeçalho e linhas (pesquisas em tabela, home)
//   sections        questionário: blocos com cabeçalho claro, itens e botão de adicionar
//   collections     aba Coletas: indicadores, filtros e cartões de coleta
//   answers         respostas de uma coleta: seções com perguntas e respostas
//   page            página de pesquisa: faixa de título, abas e conteúdo
//   profile         cartão escuro da empresa (avatar grande, nome e selos)
//   team            equipe da home: avatar, nome e situação, sem bordas
//   timeline        últimas atualizações da home: ponto e duas linhas
//   heatmap         mapa de calor da home (dias x horários)
//   inline          só spinner e texto (um arquivo, um item pequeno)
//
// Não monte spinner ou esqueleto na mão em outras telas: use <LoadingState label="Carregando X..." shape="..." />.
// Spinner dentro de botão ("Salvando...") é outra coisa: indica uma ação, não o carregamento de uma tela.
// Se uma tela nova tiver um desenho próprio, acrescente um `shape` aqui em vez de criar outro estilo.
export type LoadingShape =
    | "list"
    | "people"
    | "research-cards"
    | "copies"
    | "results-panel"
    | "team-cards"
    | "table"
    | "sections"
    | "collections"
    | "answers"
    | "page"
    | "profile"
    | "team"
    | "timeline"
    | "heatmap"
    | "inline";

interface LoadingStateProps {
    /** Texto ao lado do spinner. Ex.: "Carregando coletas..." */
    label: string;
    /** Desenho do esqueleto, igual ao conteúdo que vai aparecer. Padrão: "list". */
    shape?: LoadingShape;
    /** Quantos itens repetir (cada formato tem seu padrão). */
    count?: number;
    /** Colunas da tabela (shape "table"). Padrão: 5. */
    columns?: number;
    /** "dark" para usar sobre fundo escuro (verde da marca). */
    tone?: "light" | "dark";
    className?: string;
}

const DEFAULT_COUNT: Record<LoadingShape, number> = {
    list: 4,
    people: 6,
    "research-cards": 6,
    copies: 1,
    "results-panel": 4,
    "team-cards": 8,
    table: 4,
    sections: 2,
    collections: 3,
    answers: 2,
    page: 3,
    profile: 1,
    team: 4,
    timeline: 4,
    heatmap: 7,
    inline: 0,
};

/** Lista de 0 a n-1, para repetir elementos. */
const times = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Estado de carregamento com esqueletos (lista, cards, tabela...) e texto opcional. */
export function LoadingState({ label, shape = "list", count, columns = 5, tone = "light", className }: LoadingStateProps) {
    const dark = tone === "dark";
    const total = count ?? DEFAULT_COUNT[shape];

    // Peças do esqueleto: mesma cor e mesma pulsação em qualquer formato.
    const fill = dark ? "bg-white/10" : "bg-muted";
    const line = dark ? "border-white/10" : "border-border";
    const panel = dark ? "border-white/10 bg-white/5" : "border-border bg-white";
    const bar = (width: string, height = "h-3") => <div className={cn("rounded-full", height, width, fill)} />;
    const block = (size: string, round = "rounded-2xl") => <div className={cn("shrink-0", size, round, fill)} />;

    // Linha de lista: ícone, dois textos e um selo à direita.
    const row = (key: number, compact = false) => (
        <div key={key} className={cn("flex items-center gap-3 rounded-[20px] border", compact ? "p-2.5" : "p-3", panel)}>
            {block(compact ? "size-10" : "size-12")}
            <div className="flex-1 space-y-2">
                {bar("w-1/3", "h-3.5")}
                {bar("w-1/4")}
            </div>
            {bar("w-16", "h-6")}
        </div>
    );

    let content: React.ReactNode = null;

    if (shape === "list") {
        content = <div className="flex flex-col gap-2.5">{times(total).map((i) => row(i))}</div>;
    }

    if (shape === "people") {
        content = (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {times(total).map((i) => (
                    <div key={i} className={cn("flex flex-col gap-4 rounded-[22px] border p-4", panel)}>
                        <div className="flex items-center gap-3">
                            {block("size-12", "rounded-full")}
                            <div className="flex-1 space-y-2">
                                {bar("w-2/3", "h-3.5")}
                                {bar("w-1/3")}
                            </div>
                        </div>
                        {bar("w-1/2")}
                    </div>
                ))}
            </div>
        );
    }

    if (shape === "team-cards") {
        content = (
            <div className="flex flex-col gap-5">
                {/* painel de progresso da equipe */}
                <div className="rounded-[26px] border border-[#bcd8c9] bg-gradient-to-br from-[#e0efe7] to-[#cfe5d9] p-6">
                    <div className="flex items-center gap-4">
                        <div className="size-12 shrink-0 rounded-2xl bg-white/60" />
                        <div className="flex-1 space-y-2">
                            <div className="h-4 w-40 rounded-full bg-[#2f5d46]/15" />
                            <div className="h-3 w-64 max-w-full rounded-full bg-[#2f5d46]/15" />
                        </div>
                        <div className="hidden items-center gap-1 sm:flex">
                            {times(5).map((a) => <div key={a} className="size-10 rounded-full bg-[#2f5d46]/15 ring-2 ring-[#d6e8de]" />)}
                            <div className="ml-3 h-10 w-16 rounded-full bg-[#2f5d46]/15" />
                        </div>
                    </div>
                    <div className="mt-5 space-y-2">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-white/60">
                            <div className="h-full w-[70%] rounded-full bg-[#2f5d46]/35" />
                        </div>
                        <div className="h-2.5 w-40 rounded-full bg-[#2f5d46]/15" />
                    </div>
                </div>

                {/* título, busca e filtros */}
                <div className="flex flex-col gap-3">
                    {bar("w-48", "h-4")}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className={cn("h-11 w-full max-w-[18rem] rounded-full border", panel)} />
                        {bar("w-56", "h-9")}
                        {bar("w-40", "h-9")}
                        {bar("w-32", "h-9")}
                    </div>
                </div>

                {/* cartões: avatar e nome, situação, meta, entregue e botão */}
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))" }}>
                    {times(total).map((i) => (
                        <div key={i} className={cn("flex flex-col gap-3.5 rounded-[22px] border p-4", panel, i < 5 && !dark && "border-[#d3e3d9] bg-[#eff5f1]")}>
                            <div className="flex items-center gap-3">
                                {block("size-10", "rounded-full")}
                                <div className="flex-1 space-y-2">
                                    {bar("w-1/2", "h-3.5")}
                                    {bar("w-1/3")}
                                </div>
                            </div>
                            <div className={cn("space-y-3.5 border-t border-dashed pt-3.5", line)}>
                                <div className="flex items-center justify-between">
                                    {bar("w-16")}
                                    {bar("w-20", "h-6")}
                                </div>
                                <div className="flex items-center justify-between">
                                    {bar("w-24")}
                                    {bar("w-24", "h-9")}
                                </div>
                                <div className="flex items-center justify-between">
                                    {bar("w-14")}
                                    <div className="space-y-2">
                                        {bar("w-20", "h-3.5")}
                                        {bar("w-24", "h-2.5")}
                                    </div>
                                </div>
                            </div>
                            <div className={cn("flex justify-end border-t border-dashed pt-3.5", line)}>
                                {bar("w-28", "h-9")}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (shape === "results-panel") {
        const cols: CSSProperties = { gridTemplateColumns: "1.4fr 0.8fr 0.8fr 1.4fr 1fr" };
        content = (
            <div className="flex flex-col gap-5">
                {/* filtros: De, Até, Pesquisador e botões */}
                <div className={cn("flex flex-wrap items-end gap-3 rounded-[26px] border p-5", panel)}>
                    {[["w-8", "w-full sm:w-[15.5rem]"], ["w-8", "w-full sm:w-[15.5rem]"], ["w-20", "w-full sm:w-[15.5rem]"]].map(([label, width], i) => (
                        <div key={i} className="space-y-2">
                            {bar(label, "h-2.5")}
                            <div className={cn("h-10 rounded-full", width, fill)} />
                        </div>
                    ))}
                    <div className="ml-auto flex gap-2">
                        {bar("w-24", "h-10")}
                        {bar("w-32", "h-10")}
                        {bar("w-24", "h-10")}
                    </div>
                </div>
                {bar("w-72", "h-2.5")}

                {/* quatro indicadores */}
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                    {times(4).map((i) => (
                        <div key={i} className={cn("space-y-4 rounded-[26px] border p-5", panel)}>
                            <div className="flex items-center gap-3">
                                {block("size-10", "rounded-xl")}
                                {bar("w-24")}
                            </div>
                            {bar("w-1/2", "h-8")}
                            {bar("w-2/3", "h-2.5")}
                        </div>
                    ))}
                </div>

                {/* por pesquisador */}
                <div className={cn("rounded-[26px] border p-6", panel)}>
                    <div className="flex items-center gap-3">
                        {block("size-11", "rounded-xl")}
                        <div className="space-y-2">
                            {bar("w-36", "h-4")}
                            {bar("w-72", "h-2.5")}
                        </div>
                    </div>
                    <div className="mt-6">
                        <div className={cn("grid items-center gap-4 border-b pb-3", line)} style={cols}>
                            {times(5).map((c) => <div key={c}>{bar("w-16", "h-2.5")}</div>)}
                        </div>
                        {times(total).map((r) => (
                            <div key={r} className={cn("grid items-center gap-4 py-4", r > 0 && cn("border-t", line))} style={cols}>
                                {bar("w-2/3", "h-3.5")}
                                {bar("w-8", "h-3.5")}
                                {bar("w-14", "h-3.5")}
                                {bar("w-32", "h-3.5")}
                                {bar("w-16", "h-3.5")}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    if (shape === "copies") {
        content = (
            <div className="flex flex-col gap-5">
                {/* faixa verde: estado do questionário e contador de cópias */}
                <div className="flex items-center gap-4 rounded-[26px] border border-transparent bg-[#dcebe2] p-5 sm:p-6">
                    <div className="size-12 shrink-0 rounded-full bg-white/60" />
                    <div className="flex-1 space-y-2.5">
                        <div className="h-4 w-1/3 rounded-full bg-black/10" />
                        <div className="h-3 w-3/4 max-w-[34rem] rounded-full bg-black/10" />
                        <div className="h-3 w-1/2 max-w-[24rem] rounded-full bg-black/10" />
                    </div>
                    <div className="hidden space-y-2 sm:block">
                        <div className="ml-auto h-9 w-10 rounded-full bg-black/10" />
                        <div className="h-2.5 w-16 rounded-full bg-black/10" />
                    </div>
                </div>

                {/* quem está com a pesquisa */}
                <div className={cn("rounded-[26px] border p-6", panel)}>
                    <div className="flex items-center gap-3">
                        {block("size-11", "rounded-xl")}
                        <div className="space-y-2">
                            {bar("w-44", "h-4")}
                            {bar("w-80 max-w-full", "h-2.5")}
                        </div>
                    </div>
                    <div className="mt-6 space-y-2.5">
                        {times(Math.max(total, 1)).map((i) => (
                            <div key={i} className={cn("flex items-center gap-3 rounded-[20px] p-3", dark ? "bg-white/5" : "bg-[#f4f6f4]")}>
                                {block("size-10", "rounded-full")}
                                <div className="flex-1 space-y-2">
                                    {bar("w-1/4", "h-3.5")}
                                    {bar("w-1/5")}
                                </div>
                                {bar("w-20", "h-6")}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    if (shape === "research-cards") {
        content = (
            <div className="pa-rc-grid">
                {times(total).map((i) => (
                    <div key={i} className={cn("flex flex-col gap-3 rounded-[26px] border p-[22px]", panel)}>
                        <div className="flex items-center justify-between">
                            {bar("w-24", "h-6")}
                            {bar("w-12", "h-5")}
                        </div>
                        {bar("w-2/3", "h-5")}
                        {bar("w-1/3")}
                        <div className="flex items-center gap-4 pt-1">
                            {bar("w-24")}
                            {bar("w-16")}
                        </div>
                        <div className="flex items-center gap-3">
                            <div className={cn("h-2.5 flex-1 rounded-full", fill)} />
                            {bar("w-8")}
                        </div>
                        <div className={cn("flex items-center justify-between border-t border-dashed pt-3", line)}>
                            <div className="flex -space-x-2">
                                {times(3).map((a) => (
                                    <div key={a} className={cn("size-8 rounded-full ring-2", fill, dark ? "ring-transparent" : "ring-white")} />
                                ))}
                            </div>
                            {bar("w-16", "h-6")}
                        </div>
                        <div className="flex gap-2">
                            {bar("w-16", "h-9")}
                            {bar("w-16", "h-9")}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (shape === "table") {
        const grid: CSSProperties = { gridTemplateColumns: `2fr repeat(${Math.max(columns - 2, 1)}, 1fr) 72px` };
        const widths = ["w-3/4", "w-1/2", "w-2/3", "w-1/3"];
        content = (
            <div className={cn("overflow-hidden rounded-[22px] border", panel)}>
                <div className={cn("grid items-center gap-4 border-b px-4 py-3", line)} style={grid}>
                    {times(columns).map((c) => <div key={c}>{bar("w-16")}</div>)}
                </div>
                {times(total).map((r) => (
                    <div key={r} className={cn("grid items-center gap-4 px-4 py-3.5", r > 0 && cn("border-t", line))} style={grid}>
                        <div className="space-y-2">
                            {bar("w-3/4", "h-3.5")}
                            {bar("w-1/3")}
                        </div>
                        {times(Math.max(columns - 2, 1)).map((c) => <div key={c}>{bar(widths[(r + c) % widths.length])}</div>)}
                        <div className="justify-self-end">{bar("w-12", "h-6")}</div>
                    </div>
                ))}
            </div>
        );
    }

    if (shape === "sections") {
        content = (
            <div className="space-y-4">
                {times(total).map((i) => (
                    <div key={i} className={cn("overflow-hidden rounded-[26px] border", panel)}>
                        {/* cabeçalho claro: faixa lateral, número, rótulo + título, selos e botões */}
                        <div className={cn("relative flex items-center gap-3 rounded-t-[25px] border-b border-l-4 px-4 py-4 sm:px-5", line, dark ? "border-l-white/20 bg-white/5" : "border-l-[var(--green)]/30 bg-gradient-to-r from-[#eef5f0] to-white")}>
                            {block("size-11")}
                            <div className="flex-1 space-y-2">
                                {bar("w-16", "h-2.5")}
                                {bar("w-1/3", "h-4")}
                            </div>
                            <div className="hidden items-center gap-1.5 md:flex">
                                {bar("w-20", "h-7")}
                                {bar("w-24", "h-7")}
                            </div>
                            <div className="flex items-center gap-1.5">
                                {times(4).map((b) => <div key={b} className={cn("size-9 rounded-full", fill)} />)}
                            </div>
                        </div>
                        <div className="space-y-3 p-3 sm:p-4">
                            {times(3).map((j) => (
                                <div key={j} className="flex items-center gap-3">
                                    {block("size-7", "rounded-full")}
                                    {block("size-10", "rounded-full")}
                                    <div className="flex-1 space-y-2">
                                        {bar("w-1/3", "h-3.5")}
                                        {bar("w-16", "h-2.5")}
                                    </div>
                                    {bar("w-16", "h-5")}
                                </div>
                            ))}
                            <div className={cn("h-12 rounded-2xl border border-dashed", line)} />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (shape === "collections") {
        const tints = ["bg-[var(--forest)]/90", "bg-[#dcebe2]", "", ""];
        content = (
            <div className="flex flex-col gap-5">
                {/* quatro indicadores: o primeiro escuro, o segundo verde-claro */}
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                    {times(4).map((i) => (
                        <div key={i} className={cn("space-y-4 rounded-[26px] border p-5", i < 2 ? "border-transparent" : panel, tints[i])}>
                            <div className="flex items-center gap-2">
                                <div className={cn("size-3.5 rounded-full", i === 0 ? "bg-white/15" : "bg-black/10")} />
                                <div className={cn("h-3 w-24 rounded-full", i === 0 ? "bg-white/15" : "bg-black/10")} />
                            </div>
                            <div className={cn("h-9 w-20 rounded-full", i === 0 ? "bg-white/15" : "bg-black/10")} />
                        </div>
                    ))}
                </div>

                {/* título, busca e filtros */}
                <div className="flex flex-col gap-3">
                    {bar("w-40", "h-4")}
                    <div className={cn("h-11 w-full max-w-[22rem] rounded-full border", panel)} />
                    <div className="flex flex-wrap items-center gap-2">
                        {bar("w-56", "h-9")}
                        {bar("w-36", "h-9")}
                        {bar("w-32", "h-9")}
                        {bar("w-36", "h-9")}
                        {bar("w-28", "h-9")}
                    </div>
                </div>

                {/* cartões de coleta: número, pesquisador, início, consentimento, gravação e botão */}
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))" }}>
                    {times(total + 1).map((g) => (
                        <div key={g} className={cn("flex flex-col gap-3.5 rounded-[22px] border p-4", panel)}>
                            {bar("w-14", "h-4")}
                            <div className={cn("space-y-3.5 border-t border-dashed pt-3.5", line)}>
                                <div className="flex items-center justify-between">
                                    {bar("w-20")}
                                    <div className="flex items-center gap-2">
                                        {block("size-9", "rounded-full")}
                                        {bar("w-20", "h-3.5")}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    {bar("w-16")}
                                    <div className="space-y-2">
                                        {bar("w-20", "h-3.5")}
                                        {bar("w-10", "h-2.5")}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    {bar("w-20")}
                                    {bar("w-32", "h-6")}
                                </div>
                                <div className="flex items-center justify-between">
                                    {bar("w-14")}
                                    {bar("w-24", "h-6")}
                                </div>
                            </div>
                            <div className={cn("flex justify-end border-t border-dashed pt-3.5", line)}>
                                {bar("w-28", "h-9")}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (shape === "answers") {
        content = (
            <div className="flex flex-col gap-5">
                {times(total).map((s) => (
                    <div key={s} className="flex flex-col gap-2">
                        {bar("w-1/3", "h-4")}
                        {times(3).map((q) => (
                            <div key={q} className={cn("flex gap-3 rounded-xl border p-3", panel)}>
                                {block("size-6", "rounded-full")}
                                <div className="flex-1 space-y-2">
                                    {bar("w-2/3", "h-3.5")}
                                    {bar("w-1/2")}
                                </div>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        );
    }

    if (shape === "page") {
        content = (
            <div className="flex flex-col gap-5">
                <div className="h-40 rounded-[26px] bg-[var(--forest)]/90" />
                <div className={cn("h-11 w-full max-w-[26rem] rounded-full border", panel)} />
                <div className="flex flex-col gap-2.5">{times(total).map((i) => row(i))}</div>
            </div>
        );
    }

    if (shape === "profile") {
        content = (
            <div className="flex flex-col gap-6 rounded-[26px] bg-[var(--forest)]/90 p-7 sm:flex-row sm:items-center sm:p-9">
                <div className="size-24 shrink-0 rounded-[28px] bg-white/10" />
                <div className="flex-1 space-y-3">
                    <div className="h-3 w-20 rounded-full bg-white/10" />
                    <div className="h-9 w-2/3 rounded-full bg-white/10" />
                    <div className="flex gap-2.5">
                        <div className="h-7 w-24 rounded-full bg-white/10" />
                        <div className="h-7 w-28 rounded-full bg-white/10" />
                    </div>
                </div>
            </div>
        );
    }

    if (shape === "team") {
        content = (
            <div className="flex flex-col">
                {times(total).map((i) => (
                    <div key={i} className={cn("flex items-center gap-3 py-3", i > 0 && cn("border-t", line))}>
                        {block("size-10", "rounded-full")}
                        <div className="flex-1 space-y-2">
                            {bar("w-1/3", "h-3.5")}
                            {bar("w-1/2")}
                        </div>
                        {bar("w-16", "h-5")}
                    </div>
                ))}
            </div>
        );
    }

    if (shape === "timeline") {
        content = (
            <div className="flex flex-col gap-4">
                {times(total).map((i) => (
                    <div key={i} className="flex items-start gap-3">
                        {block("mt-1 size-3", "rounded-full")}
                        <div className="flex-1 space-y-2">
                            {bar("w-2/3", "h-3.5")}
                            {bar("w-1/4")}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (shape === "heatmap") {
        content = (
            <div className="pa-heat">
                {times(total).map((d) => (
                    <div className="row" key={d}>
                        <span className="rl">{bar("w-6")}</span>
                        {times(12).map((c) => <i key={c} className={fill} />)}
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className={cn("flex flex-col gap-4", className)} aria-busy="true" aria-live="polite">
            <div
                className={cn(
                    "flex items-center gap-2",
                    shape === "inline" ? "text-xs" : "text-sm",
                    dark ? "text-[var(--muted-dark)]" : "text-muted-foreground",
                )}
            >
                <Spinner />
                {label}
            </div>

            {content && <div className="animate-pulse">{content}</div>}
        </div>
    );
}

"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import { Contour } from "@/components/ui/contour";
import { LoadingState } from "@/components/ui/loadingState";
import { DEFAULT_PAGE_SIZES, Pagination, usePagination } from "@/components/ui/pagination";
import { avatarTone } from "@/lib/fieldData";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { ArrowDownAZ, CalendarClock, LayoutGrid, List, RefreshCw, Search, SearchX, X } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import "./data-table.css";

// Padrão ÚNICO de tabela do painel. Toda listagem em linhas e colunas (pesquisas, pesquisadores,
// empresas, administradores, coletas, equipe da pesquisa) usa estes componentes, para que
// cabeçalho, busca, filtros, linhas, selos, ações e estados vazios sejam sempre iguais:
//
//   <DataTableHeader>   título da tabela + contador
//   <TableTabs>         abas que trocam a tabela (sempre no topo, à esquerda)
//   <DataTableToolbar>  busca (<TableSearch>), filtros (<TableFilters>) e controles extras
//   <TableViewControls> ordem (Recentes | A-Z) e modo de exibição (Lista | Cards): toda tabela tem
//   <DataTable>         a tabela (cabeçalho fixo, rolagem, carregando e vazio já resolvidos);
//                       com view="cards" desenha as MESMAS colunas como cartões.
//                       PAGINADA por padrão (10 por página, com seletor 10/25/50/100): o navegador
//                       desenha só uma página por vez. `pageSize={false}` desliga (só para listas curtas).
//   sortRows()          ordena as linhas para Recentes / A-Z
//   <PersonCell>        avatar + nome + @usuário (primeira coluna de qualquer pessoa)
//   <CellTitle>         título + linha menor (primeira coluna dos demais registros)
//   <RowActions>        coluna de ações, sempre alinhada à direita (botões <Button size="sm"> ou <RowLink>)
//   <TableChip>         selo de situação (mesmas cores em todas as telas)
//
// Não monte <table> na mão nem use o componente "Tabela" antigo: use <DataTable>.
// Se uma tela precisar de algo novo, acrescente aqui em vez de criar outro estilo.

export type DataColumn<T> = {
    id: string;
    /** Texto do cabeçalho. */
    header: string;
    cell: (row: T) => ReactNode;
    /** Coluna de ações / números: alinhada à direita. */
    align?: "right";
    /** Largura mínima da coluna, em CSS (ex.: "12rem"). */
    minWidth?: string;
    /** Esconde o texto do cabeçalho (ele continua para leitores de tela). */
    hideHeader?: boolean;
};

/** Modo de exibição: tabela em linhas ("table", o botão "Lista") ou cartões ("cards"). */
export type TableView = "table" | "cards";

// Celular (até 640px): mesma largura usada no data-table.css para esconder o seletor Lista/Cards.
const COMPACT_QUERY = "(max-width: 640px)";
/** Lê se a tela está no modo compacto (consulta de mídia `COMPACT_QUERY`). */
const readCompact = () => window.matchMedia(COMPACT_QUERY).matches;

/**
 * Estado do modo de exibição (Lista/Cards). Começa em `desktopDefault`; em telas
 * pequenas começa em cartões, mas a pessoa pode trocar para lista quando quiser.
 */
export function useTableView(desktopDefault: TableView = "cards") {
    const [view, setView] = useState<TableView>(desktopDefault);
    useEffect(() => {
        if (readCompact()) setView("cards");
    }, []);
    return [view, setView] as const;
}

/** Ordem padrão: mais recentes primeiro ou alfabética. */
export type TableSort = "recent" | "name";

type DataTableProps<T> = {
    columns: readonly DataColumn<T>[];
    rows: readonly T[];
    getRowKey: (row: T) => string | number;
    /** Nome da tabela para leitores de tela. */
    label: string;
    loading?: boolean;
    loadingLabel?: string;
    /** Mostrado quando não há linhas. Use <TableEmpty>. */
    empty?: ReactNode;
    /** Altura máxima da área da tabela (ex.: "26rem"); passando disso, rola com o cabeçalho fixo. */
    maxHeight?: string;
    /** Classe extra da área da tabela (ex.: uma classe "max-h-96" do Tailwind). */
    className?: string;
    /** Largura mínima antes de aparecer a rolagem horizontal. */
    minWidth?: string;
    /** Realça a linha (ex.: pesquisador já vinculado). */
    rowTone?: (row: T) => "on" | "off" | undefined;
    /**
     * "table" ou "cards" (padrão do painel: cards). Nos cartões a primeira coluna vira o título, as colunas com
     * `hideHeader` (ações) vão para o rodapé e as demais viram pares "nome: valor".
     */
    view?: TableView;
    /**
     * Itens por página no começo (padrão: 10). O usuário troca no rodapé. A tabela volta para a
     * página 1 quando a busca, o filtro ou a ordem mudam o primeiro item. `false` mostra tudo.
     */
    pageSize?: number | false;
    /** Tamanhos oferecidos no seletor do rodapé (padrão: 10, 25, 50 e 100). */
    pageSizeOptions?: readonly number[];
    /**
     * Paginação feita no SERVIDOR: `rows` já é só a página atual (a API traz uma página por vez) e o
     * rodapé usa estes números. Veja `usePagedResource(...).server`. Sem isso, a tabela recorta `rows` aqui.
     */
    server?: {
        page: number;
        pageSize: number;
        total: number;
        onPageChange: (page: number) => void;
        onPageSizeChange: (size: number) => void;
        /** Buscando outra página: a tabela fica esmaecida até chegar. */
        fetching?: boolean;
    };
};

/**
 * Tabela padrão do painel: cabeçalho fixo, rolagem, carregando e vazio já resolvidos, com modo
 * Lista ou Cards e paginação do servidor.
 */
export function DataTable<T>({
    columns,
    rows,
    getRowKey,
    label,
    loading = false,
    loadingLabel = "Carregando...",
    empty,
    maxHeight,
    className,
    minWidth = "640px",
    rowTone,
    view: requestedView = "table",
    pageSize = 10,
    pageSizeOptions,
    server,
}: DataTableProps<T>) {
    // O modo escolhido vale em qualquer tela. No celular a lista rola na horizontal;
    // o padrão inicial em telas pequenas (cartões) vem de useTableView.
    const view: TableView = requestedView;
    const paginate = pageSize !== false && !server;
    const pager = usePagination(rows, {
        pageSize: paginate ? (pageSize as number) : undefined,
        pageSizeOptions,
        resetKey: rows.length > 0 ? getRowKey(rows[0]) : null,
    });

    if (loading) {
        return view === "cards" ? (
            <LoadingState label={loadingLabel} shape="people" />
        ) : (
            <LoadingState label={loadingLabel} shape="table" columns={Math.min(columns.length, 6)} count={4} />
        );
    }

    if (rows.length === 0) return <>{empty ?? <TableEmpty title="Nada por aqui ainda." />}</>;

    // Só as linhas da página atual vão para a tela.
    const shown = paginate ? pager.items : rows;

    const serverSizes = pageSizeOptions ?? DEFAULT_PAGE_SIZES;
    const footer = server ? (
        server.total > Math.min(...serverSizes) && (
            <Pagination
                page={server.page}
                totalPages={Math.max(1, Math.ceil(server.total / server.pageSize))}
                total={server.total}
                pageSize={server.pageSize}
                pageSizeOptions={[...new Set([...serverSizes, server.pageSize])].sort((a, b) => a - b)}
                onPageChange={server.onPageChange}
                onPageSizeChange={server.onPageSizeChange}
                label={label}
            />
        )
    ) : (
        paginate && pager.visible && <Pagination {...pager.pagerProps} label={label} />
    );

    if (view === "cards") {
        const [titleColumn, ...others] = columns;
        const fields = others.filter((column) => !column.hideHeader);
        const actions = others.filter((column) => column.hideHeader);

        return (
            <div className="pa-dt-root" aria-busy={server?.fetching || undefined} data-fetching={server?.fetching || undefined}>
                <div className={`pa-dt-wrap ${className ?? ""}`} style={maxHeight ? { maxHeight } : undefined}>
                    <ul className="pa-dt-cards" aria-label={label}>
                        {shown.map((row) => (
                            <li key={getRowKey(row)} className={`pa-dt-card ${rowTone?.(row) ?? ""}`}>
                                <div className="head">{titleColumn.cell(row)}</div>
                                {fields.length > 0 && (
                                    <dl>
                                        {fields.map((column) => (
                                            <div key={column.id} className="f">
                                                <dt>{column.header}</dt>
                                                <dd>{column.cell(row)}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                )}
                                {actions.length > 0 && (
                                    <div className="foot">
                                        {actions.map((column) => (
                                            <Fragment key={column.id}>{column.cell(row)}</Fragment>
                                        ))}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
                {footer}
            </div>
        );
    }

    return (
        <div className="pa-dt-root" aria-busy={server?.fetching || undefined} data-fetching={server?.fetching || undefined}>
            <div className={`pa-dt-wrap ${className ?? ""}`} style={maxHeight ? { maxHeight } : undefined}>
                <table className="pa-dt" style={{ minWidth }} aria-label={label}>
                    <thead>
                        <tr>
                            {columns.map((column) => (
                                <th
                                    key={column.id}
                                    scope="col"
                                    className={column.align === "right" ? "r" : undefined}
                                    style={column.minWidth ? { minWidth: column.minWidth } : undefined}
                                >
                                    {column.hideHeader ? <span className="sr-only">{column.header}</span> : column.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((row) => (
                            <tr key={getRowKey(row)} className={rowTone?.(row)}>
                                {columns.map((column) => (
                                    <td key={column.id} className={column.align === "right" ? "r" : undefined}>
                                        {column.cell(row)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {footer}
        </div>
    );
}

/* ------------------------------------------------------------------
   Cabeçalho e barra de ferramentas
   ------------------------------------------------------------------ */

/** Título da tabela, com contador e conteúdo extra. */
export function DataTableHeader({ title, count, children }: { title: string; count?: number | string; children?: ReactNode }) {
    return (
        <div className="pa-dt-head">
            <h4>{title}</h4>
            {count !== undefined && <span className="pa-chip gray">{count}</span>}
            {children && <div className="end">{children}</div>}
        </div>
    );
}

/** Barra acima da tabela, com busca, filtros e controles extras. */
export function DataTableToolbar({ children }: { children: ReactNode }) {
    return <div className="pa-dt-bar">{children}</div>;
}

/** Campo de busca da tabela. */
export function TableSearch({
    value,
    onChange,
    placeholder,
    label,
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    label: string;
}) {
    return (
        <div className="pa-dt-search">
            <Search aria-hidden="true" />
            <input
                type="text"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                aria-label={label}
                autoComplete="off"
            />
            {value && (
                <button type="button" onClick={() => onChange("")} aria-label="Limpar busca">
                    <X />
                </button>
            )}
        </div>
    );
}

/** Filtros em selos com contador (Todos / Ativos / …). */
export function TableFilters<V extends string>({
    value,
    onChange,
    options,
    label,
}: {
    value: V;
    onChange: (value: V) => void;
    options: { value: V; label: string; count?: number; icon?: ReactNode }[];
    label: string;
}) {
    return (
        <div className="pa-dt-seg" role="group" aria-label={label}>
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    className={option.value === value ? "on" : undefined}
                    aria-pressed={option.value === value}
                    onClick={() => onChange(option.value)}
                >
                    {option.icon}
                    {option.label}
                    {option.count !== undefined && <em>{option.count}</em>}
                </button>
            ))}
        </div>
    );
}

type SortOption<S extends string> = { value: S; label: string; icon?: ReactNode };

const DEFAULT_SORT_OPTIONS: SortOption<TableSort>[] = [
    { value: "recent", label: "Recentes", icon: <CalendarClock /> },
    { value: "name", label: "A-Z", icon: <ArrowDownAZ /> },
];

/**
 * Os dois grupos de botões que TODA tabela tem: ordem (Recentes | A-Z) e modo de exibição
 * (Lista | Cards). Vai dentro da <DataTableToolbar>, junto dos filtros da tela.
 * Telas com uma ordem a mais (ex.: "Prazo") passam `sortOptions`.
 */
export function TableViewControls<S extends string = TableSort>({
    sort,
    onSortChange,
    view,
    onViewChange,
    sortOptions,
    onRefresh,
    refreshing = false,
}: {
    sort: S;
    onSortChange: (value: S) => void;
    view: TableView;
    onViewChange: (value: TableView) => void;
    sortOptions?: SortOption<S>[];
    /** Recarrega os dados da tabela (botão "Atualizar"). */
    onRefresh?: () => void;
    /** Enquanto true, o ícone gira e o botão fica desativado. */
    refreshing?: boolean;
}) {
    return (
        <>
            <TableFilters<S>
                label="Ordenar"
                value={sort}
                onChange={onSortChange}
                options={sortOptions ?? (DEFAULT_SORT_OPTIONS as unknown as SortOption<S>[])}
            />
            <TableFilters<TableView>
                label="Modo de exibição"
                value={view}
                onChange={onViewChange}
                options={[
                    { value: "table", label: "Lista", icon: <List /> },
                    { value: "cards", label: "Cards", icon: <LayoutGrid /> },
                ]}
            />
            {onRefresh && <TableRefreshButton onRefresh={onRefresh} refreshing={refreshing} />}
        </>
    );
}

/**
 * Botão "Atualizar" da tabela (contorno, ícone girando enquanto busca). Já vem dentro de
 * <TableViewControls onRefresh>.
 */
export function TableRefreshButton({ onRefresh, refreshing = false }: { onRefresh: () => void; refreshing?: boolean }) {
    return (
        <Button variant="outline" size="sm" className="pa-dt-refresh" onClick={onRefresh} disabled={refreshing} title="Atualizar agora">
            <RefreshCw className={refreshing ? "animate-spin" : undefined} aria-hidden="true" />
            Atualizar
        </Button>
    );
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

/**
 * Ordena para "Recentes" (data mais nova primeiro) ou "A-Z" (nome). Devolve uma cópia.
 * `date` pode devolver texto ISO, milissegundos ou nada (vai para o fim).
 */
export function sortRows<T>(
    rows: readonly T[],
    sort: TableSort,
    get: { name: (row: T) => string | null | undefined; date: (row: T) => string | number | null | undefined },
): T[] {
    const time = (row: T) => {
        const value = get.date(row);
        const ms = typeof value === "number" ? value : value ? new Date(value).getTime() : NaN;
        return Number.isNaN(ms) ? 0 : ms;
    };
    return [...rows].sort((a, b) =>
        sort === "name" ? collator.compare(get.name(a) ?? "", get.name(b) ?? "") : time(b) - time(a),
    );
}

/**
 * Abas que trocam o conteúdo da tabela (Pesquisas | Pesquisadores, Empresas | Administradores).
 * Ficam sempre no topo, à esquerda, acima do título da tabela, com ícone e contador.
 */
export function TableTabs<V extends string>(props: {
    value: V;
    onChange: (value: V) => void;
    options: { value: V; label: string; count?: number; icon?: ReactNode }[];
    label: string;
}) {
    return (
        <div className="pa-dt-tabs">
            <TableFilters<V> {...props} />
        </div>
    );
}

/* ------------------------------------------------------------------
   Células
   ------------------------------------------------------------------ */

/** Foto do usuário, ou as iniciais quando não há foto; a cor das iniciais é fixa por id. */
export function TableAvatar({
    id,
    name,
    square = false,
    avatarUrl,
}: {
    id: number;
    name?: string | null;
    square?: boolean;
    avatarUrl?: string | null;
}) {
    return (
        <UserAvatar
            name={name ?? ""}
            src={avatarUrl}
            size={40}
            ariaHidden
            fit={square ? "contain" : "cover"}
            className={`avatar-pa pa-dt-av ${avatarTone(id)} ${square ? "sq" : ""}`}
        />
    );
}

/** Primeira coluna de qualquer pessoa: avatar, nome e @usuário. */
export function PersonCell({
    id,
    name,
    username,
    sub,
    badge,
    square = false,
    avatarUrl,
}: {
    id: number;
    name: string;
    username?: string;
    /** Linha menor no lugar do @usuário (ex.: contato da empresa). */
    sub?: ReactNode;
    badge?: ReactNode;
    square?: boolean;
    /** Foto do usuário (nulo = iniciais). */
    avatarUrl?: string | null;
}) {
    return (
        <div className="pa-dt-person">
            <TableAvatar id={id} name={name} square={square} avatarUrl={avatarUrl} />
            <div className="tx">
                <b title={name}>{name}</b>
                {(sub ?? username) && <small>{sub ?? `@${username}`}</small>}
            </div>
            {badge}
        </div>
    );
}

/** Primeira coluna dos demais registros: título e uma linha menor abaixo. */
export function CellTitle({ title, sub, href }: { title: ReactNode; sub?: ReactNode; href?: string }) {
    return (
        <div className="pa-dt-title">
            {href ? (
                <Link href={href} className="t link">{title}</Link>
            ) : (
                <span className="t">{title}</span>
            )}
            {sub && <small>{sub}</small>}
        </div>
    );
}

/** Coluna de ações da linha, alinhada à direita. */
export function RowActions({ children }: { children: ReactNode }) {
    return <div className="pa-dt-actions">{children}</div>;
}

/** Link de ação da linha (ex.: "Abrir"), com o mesmo visual dos botões de ação. */
export function RowLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <Link href={href} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            {children}
        </Link>
    );
}

/** Valor secundário (datas, "Sem equipe", "—"). */
export function Muted({ children }: { children: ReactNode }) {
    return <span className="pa-dt-muted">{children}</span>;
}

type ChipTone = "live" | "soon" | "off" | "done";

const CHIP_CLASS: Record<ChipTone, string> = {
    live: "light", // verde: ativo, em campo, na equipe
    soon: "clay", // argila: atenção, prazo perto, gravada
    off: "clay", // argila: inativo, rascunho
    done: "gray", // cinza: encerrado, disponível, neutro
};

/** Selo de situação, com as mesmas cores em todas as telas (`tone`). */
export function TableChip({ tone, children, title }: { tone: ChipTone; children: ReactNode; title?: string }) {
    return (
        <span className={`pa-chip ${CHIP_CLASS[tone]}`} title={title}>
            <i />
            {children}
        </span>
    );
}

/* ------------------------------------------------------------------
   Estado vazio
   ------------------------------------------------------------------ */

/** Estado vazio da tabela: ícone, título e texto. */
export function TableEmpty({
    title,
    text,
    icon,
    onClear,
}: {
    title: string;
    text?: string;
    icon?: ReactNode;
    /** Quando passado, mostra "Limpar filtros". */
    onClear?: () => void;
}) {
    return (
        <div className="pa-dt-empty">
            <Contour seed={4} rings={9} cx={0.5} cy={0.5} size={1.1} style={{ opacity: 0.3 }} />
            <div className="in">
                <span className="ic">{icon ?? <SearchX />}</span>
                <p className="t">{title}</p>
                {text && <p className="s">{text}</p>}
                {onClear && (
                    <button type="button" className="pa-dt-clear" onClick={onClear}>
                        <X /> Limpar filtros
                    </button>
                )}
            </div>
        </div>
    );
}

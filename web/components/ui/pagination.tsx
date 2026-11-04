"use client";

import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import "./data-table.css";

// Paginação ÚNICA do painel. Tudo que pode crescer (tabelas, cartões, históricos) usa uma destas peças,
// para o navegador desenhar só uma página por vez e a tela nunca travar com milhares de itens:
//
//   usePagination()   recorta a lista em páginas e guarda a página e o tamanho escolhidos
//   <Pagination>     o rodapé (intervalo mostrado, itens por página, anterior/próxima e números)
//   <PaginatedList>  lista pronta (ul/div + rodapé) para quem não precisa de nada além de mapear os itens
//
// <DataTable> (components/ui/data-table.tsx) já usa o hook: toda tabela é paginada sem configurar nada.

export const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const;

type PaginationOptions = {
    /** Itens por página no começo. Padrão: 10. */
    pageSize?: number;
    /** Tamanhos oferecidos no seletor. Padrão: 10, 25, 50 e 100. */
    pageSizeOptions?: readonly number[];
    /**
     * Quando este valor muda, volta para a página 1 (ex.: texto da busca + filtro + ordem).
     * Quem não passa nada usa uma chave automática; veja `getKey`.
     */
    resetKey?: unknown;
};

export type PaginationProps = {
    page: number;
    totalPages: number;
    total: number;
    pageSize: number;
    pageSizeOptions: readonly number[];
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    /** Nome da lista para leitores de tela (ex.: "Coletas recebidas"). */
    label?: string;
    className?: string;
};

/** Junta o tamanho inicial às opções, sem repetir e em ordem crescente. */
function withInitialSize(options: readonly number[], initial: number): number[] {
    return [...new Set([...options, initial])].filter((n) => n > 0).sort((a, b) => a - b);
}

/**
 * Recorta `items` em páginas. Devolve a página atual (`items`), o intervalo mostrado e as props
 * prontas para <Pagination {...pagerProps} />.
 *
 * - Se a lista encolher (exclusão, filtro), a página atual é ajustada sozinha.
 * - `resetKey` volta para a página 1 quando a busca, o filtro ou a ordem mudam.
 */
export function usePagination<T>(items: readonly T[], options: PaginationOptions = {}) {
    const { pageSize: initialSize = 10, pageSizeOptions = DEFAULT_PAGE_SIZES, resetKey } = options;

    const [pageState, setPageState] = useState(1);
    const [size, setSize] = useState(initialSize);
    const [lastResetKey, setLastResetKey] = useState(resetKey);

    // Ajuste durante a renderização (padrão do React): evita um quadro com a página antiga.
    let requested = pageState;
    if (!Object.is(lastResetKey, resetKey)) {
        setLastResetKey(resetKey);
        setPageState(1);
        requested = 1;
    }

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / size));
    const page = Math.min(Math.max(1, requested), totalPages);
    const start = (page - 1) * size;

    const pageItems = useMemo(() => items.slice(start, start + size), [items, start, size]);

    const goTo = useCallback(
        (next: number) => {
            setPageState(Math.min(Math.max(1, next), totalPages));
        },
        [totalPages],
    );

    const changeSize = useCallback((next: number) => {
        setSize(next);
        setPageState(1);
    }, []);

    const sizes = useMemo(() => withInitialSize(pageSizeOptions, initialSize), [pageSizeOptions, initialSize]);

    return {
        /** Os itens da página atual. */
        items: pageItems,
        page,
        pageSize: size,
        total,
        totalPages,
        /** O rodapé só faz sentido quando há mais itens que o menor tamanho de página. */
        visible: total > sizes[0],
        pagerProps: {
            page,
            totalPages,
            total,
            pageSize: size,
            pageSizeOptions: sizes,
            onPageChange: goTo,
            onPageSizeChange: changeSize,
        } satisfies PaginationProps,
    };
}

/** Números de página a mostrar: 1 … 4 5 6 … 20 (no máximo 7 posições). */
function pageList(current: number, total: number): (number | "gap-start" | "gap-end")[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, "gap-end", total];
    if (current >= total - 3) return [1, "gap-start", total - 4, total - 3, total - 2, total - 1, total];
    return [1, "gap-start", current - 1, current, current + 1, "gap-end", total];
}

/** Rodapé da paginação. Fica escondido quando tudo cabe na primeira página (veja `usePagination().visible`). */
export function Pagination({
    page,
    totalPages,
    total,
    pageSize,
    pageSizeOptions,
    onPageChange,
    onPageSizeChange,
    label,
    className,
}: PaginationProps) {
    const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);
    const self = useRef<HTMLDivElement>(null);

    // Ao trocar de página, a lista volta para a vista se o topo dela ficou acima da tela.
    const go = (next: number) => {
        onPageChange(next);
        const root = self.current?.closest(".pa-dt-root");
        if (root && root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: "start", behavior: "smooth" });
    };

    const first = page <= 1;
    const last = page >= totalPages;

    return (
        <div ref={self} className={cn("pa-pg", className)}>
            <p className="info" aria-live="polite">
                Mostrando <b>{from}–{to}</b> de <b>{total}</b>
            </p>

            <label className="size">
                <span>Por página</span>
                <select
                    value={pageSize}
                    onChange={(event) => onPageSizeChange(Number(event.target.value))}
                    aria-label={label ? `Itens por página: ${label}` : "Itens por página"}
                >
                    {pageSizeOptions.map((option) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>
            </label>

            <nav aria-label={label ? `Paginação: ${label}` : "Paginação"}>
                <button type="button" onClick={() => go(1)} disabled={first} aria-label="Primeira página" title="Primeira página">
                    <ChevronsLeft aria-hidden="true" />
                </button>
                <button type="button" onClick={() => go(page - 1)} disabled={first} aria-label="Página anterior" title="Página anterior">
                    <ChevronLeft aria-hidden="true" />
                </button>

                <span className="pos">
                    Página {page} de {totalPages}
                </span>

                <span className="nums">
                    {pageList(page, totalPages).map((entry) =>
                        typeof entry === "string" ? (
                            <span key={entry} className="gap" aria-hidden="true">
                                …
                            </span>
                        ) : (
                            <button
                                key={entry}
                                type="button"
                                className={entry === page ? "on" : undefined}
                                aria-current={entry === page ? "page" : undefined}
                                aria-label={`Página ${entry}`}
                                onClick={() => go(entry)}
                            >
                                {entry}
                            </button>
                        ),
                    )}
                </span>

                <button type="button" onClick={() => go(page + 1)} disabled={last} aria-label="Próxima página" title="Próxima página">
                    <ChevronRight aria-hidden="true" />
                </button>
                <button type="button" onClick={() => go(totalPages)} disabled={last} aria-label="Última página" title="Última página">
                    <ChevronsRight aria-hidden="true" />
                </button>
            </nav>
        </div>
    );
}

type PaginatedListProps<T> = PaginationOptions & {
    items: readonly T[];
    /** Desenha UM item (devolva o <li> ou o cartão já com `key`). */
    children: (item: T) => ReactNode;
    /** Chave de cada item: usada para voltar à página 1 quando o primeiro item muda. */
    getKey: (item: T) => string | number;
    /** "ul" (padrão) ou "div". */
    as?: "ul" | "div";
    /** Classe do <ul>/<div> que contém os itens. */
    className?: string;
    /** Nome da lista para leitores de tela. */
    label?: string;
};

/**
 * Lista paginada pronta: os itens da página e o rodapé. Use quando a lista fica depois de um
 * `return` antecipado (onde não dá para chamar o hook) ou quando basta mapear os itens.
 */
export function PaginatedList<T>({
    items,
    children,
    getKey,
    as = "ul",
    className,
    label,
    pageSize,
    pageSizeOptions,
    resetKey,
}: PaginatedListProps<T>) {
    const pager = usePagination(items, {
        pageSize,
        pageSizeOptions,
        resetKey: resetKey ?? (items.length > 0 ? getKey(items[0]) : null),
    });
    const Tag = as;

    return (
        <div className="pa-dt-root">
            <Tag className={className} aria-label={label}>
                {pager.items.map((item) => children(item))}
            </Tag>
            {pager.visible && <Pagination {...pager.pagerProps} label={label} />}
        </div>
    );
}

/** Rodapé para listas paginadas NO SERVIDOR (veja `usePagedResource(...).server`). */
export function ServerPagination({
    server,
    label,
    pageSizeOptions = DEFAULT_PAGE_SIZES,
}: {
    server: {
        page: number;
        pageSize: number;
        total: number;
        onPageChange: (page: number) => void;
        onPageSizeChange: (size: number) => void;
    };
    label?: string;
    pageSizeOptions?: readonly number[];
}) {
    if (server.total <= Math.min(...pageSizeOptions)) return null;

    return (
        <Pagination
            page={server.page}
            totalPages={Math.max(1, Math.ceil(server.total / server.pageSize))}
            total={server.total}
            pageSize={server.pageSize}
            pageSizeOptions={withInitialSize(pageSizeOptions, server.pageSize)}
            onPageChange={server.onPageChange}
            onPageSizeChange={server.onPageSizeChange}
            label={label}
        />
    );
}

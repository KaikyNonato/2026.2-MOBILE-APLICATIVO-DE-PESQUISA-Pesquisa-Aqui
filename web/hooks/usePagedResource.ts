"use client";

import { isSessionExpiredError } from "@/lib/apiFetcher";
import type { Page } from "@/lib/pagination";
import { useCallback, useEffect, useRef, useState } from "react";

// Lista paginada NO SERVIDOR: cada troca de página, busca ou filtro faz uma requisição que traz só
// aquela página (nunca a lista inteira). Mostra a página anterior enquanto a nova carrega.
//
//   const list = usePagedResource((p) => getResearchesPage({ ...p, status }), { filters: { status }, pageSize: 10 })
//   list.items, list.total, list.search/setSearch, list.loading (1ª carga), list.fetching (trocando de página)

type Options = {
    /** Itens por página no começo. Padrão: 10. */
    pageSize?: number;
    /** Tudo que filtra ou ordena a lista (status, ordem...). Mudou? Volta para a página 1. */
    filters?: Record<string, string | number | undefined>;
    /** Espera o usuário parar de digitar antes de buscar. Padrão: 350 ms. */
    debounceMs?: number;
    /** Com `false` não faz nenhuma requisição (ex.: quem não tem permissão). */
    enabled?: boolean;
};

type Params = { page: number; pageSize: number; q: string };

type State<P> = { key: string; data?: P; error?: string; errorStatus?: number };

/**
 * Hook de lista paginada no servidor: busca a página, aplica busca com atraso (debounce) e filtros,
 * e expõe página, tamanho e estado de carregamento.
 */
export function usePagedResource<T, P extends Page<T> = Page<T>>(fetcher: (params: Params) => Promise<P>, options: Options = {}) {
    const { pageSize: initialSize = 10, filters, debounceMs = 350, enabled = true } = options;

    const [page, setPage] = useState(1);
    const [pageSize, setPageSizeState] = useState(initialSize);
    const [search, setSearchState] = useState("");
    const [debounced, setDebounced] = useState("");
    const [reloadToken, setReloadToken] = useState(0);
    const [state, setState] = useState<State<P> | null>(null);

    // O texto da busca só vira requisição depois de uma pausa na digitação.
    useEffect(() => {
        const timer = window.setTimeout(() => setDebounced(search.trim()), search.trim() === "" ? 0 : debounceMs);
        return () => window.clearTimeout(timer);
    }, [search, debounceMs]);

    // Filtros, ordem ou busca mudaram: volta para a página 1 (ajuste na renderização, sem quadro extra).
    const filtersKey = JSON.stringify(filters ?? {});
    const resetKey = `${filtersKey}|${debounced}`;
    const [lastResetKey, setLastResetKey] = useState(resetKey);
    const resetPage = lastResetKey !== resetKey;
    if (resetPage) {
        setLastResetKey(resetKey);
        setPage(1);
    }

    // A página nunca passa da última (ex.: excluiu o único item da última página). Ajuste na renderização.
    const data = state?.data;
    const requestedPage = resetPage ? 1 : page;
    const currentPage = data && requestedPage > data.totalPages ? data.totalPages : requestedPage;
    if (!resetPage && currentPage !== page) setPage(currentPage);

    const fetcherRef = useRef(fetcher);
    useEffect(() => {
        fetcherRef.current = fetcher;
    });

    const key = JSON.stringify([currentPage, pageSize, debounced, filtersKey, reloadToken, enabled]);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        fetcherRef
            .current({ page: currentPage, pageSize, q: debounced })
            .then((data) => {
                if (!cancelled) setState({ key, data });
            })
            .catch((error) => {
                if (cancelled || isSessionExpiredError(error)) return;
                setState((previous) => ({
                    key,
                    data: previous?.data,
                    error: error instanceof Error ? error.message : "Erro ao carregar a lista",
                    errorStatus: (error as { status?: number })?.status,
                }));
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` já resume todas as entradas da consulta
    }, [key]);

    const totalPages = data?.totalPages ?? 1;

    const setSearch = useCallback((value: string) => setSearchState(value), []);
    const setPageSize = useCallback((size: number) => {
        setPageSizeState(size);
        setPage(1);
    }, []);
    const reload = useCallback(() => setReloadToken((n) => n + 1), []);

    /** Altera os itens da página atual na tela, sem nova requisição (ex.: depois de editar um registro). */
    const mutate = useCallback((update: (items: T[]) => T[]) => {
        setState((previous) => (previous?.data ? { ...previous, data: { ...previous.data, items: update(previous.data.items) } } : previous));
    }, []);

    return {
        items: data?.items ?? [],
        /** A resposta inteira da API (para quem recebe campos extras junto da página, como um resumo). */
        data,
        total: data?.total ?? 0,
        totalPages,
        page: Math.min(currentPage, totalPages),
        pageSize,
        /** true só até a primeira resposta chegar. */
        loading: enabled && !state,
        /** true enquanto busca outra página ou outro texto (a lista anterior continua na tela). */
        fetching: enabled && !!state && state.key !== key,
        error: state?.error ?? null,
        /** Código HTTP do erro, quando a API respondeu (ex.: 403). */
        errorStatus: state?.errorStatus,
        search,
        /** Texto que já virou requisição. */
        query: debounced,
        setSearch,
        setPage,
        setPageSize,
        reload,
        mutate,
        /** Props prontas para <DataTable server={...} />. */
        server: {
            page: Math.min(currentPage, totalPages),
            pageSize,
            total: data?.total ?? 0,
            onPageChange: setPage,
            onPageSizeChange: setPageSize,
            fetching: enabled && !!state && state.key !== key,
        },
    };
}

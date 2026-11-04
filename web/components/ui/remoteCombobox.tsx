"use client";

import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
} from "@/components/ui/combobox";
import { isSessionExpiredError } from "@/lib/apiFetcher";
import type { Page } from "@/lib/pagination";
import { useEffect, useRef, useState } from "react";

// Seletor para opções que vêm da API (empresas, pesquisadores...). Em vez de baixar todas as opções, ele:
//   - só consulta a API quando a lista é aberta;
//   - pesquisa no SERVIDOR enquanto o usuário digita (depois de uma pequena pausa);
//   - carrega as opções aos poucos: uma página por vez, e a próxima só vem quando a rolagem chega perto do fim.
// A API nunca devolve mais de 100 itens por página; aqui o padrão é 10.
//
//   <RemoteComboBox
//       fetchOptions={(p) => getCompaniesPage({ ...p, situation: "ACTIVE" }).then(toOptions)}
//       value={companyId}
//       onValueChange={setCompanyId}
//   />

export interface RemoteOption {
    value: string;
    label: string;
    /** Linha menor ao lado do nome (ex.: @usuario). */
    hint?: string;
}

interface RemoteComboBoxProps {
    /** Busca uma página de opções. Receba `q` (texto digitado) e repasse à API. */
    fetchOptions: (params: { page: number; pageSize: number; q: string }) => Promise<Page<RemoteOption>>;
    /** Valor selecionado ("" = nenhum). */
    value: string;
    onValueChange: (value: string, option: RemoteOption | null) => void;
    /** Nome a mostrar quando `value` já vem preenchido e a opção ainda não foi carregada (ex.: edição). */
    selectedLabel?: string;
    placeholder?: string;
    emptyMessage?: string;
    /** Opções carregadas por vez (a cada vez que a rolagem chega ao fim). Padrão: 10; a API aceita até 100. */
    pageSize?: number;
    /** Mostra o "x" para limpar a escolha (útil em filtros como "Todos"). */
    clearable?: boolean;
    disabled?: boolean;
    /** Muda quando as opções precisam ser consultadas de novo (ex.: outra pesquisa). */
    reloadKey?: string | number;
}

/** Opções já carregadas (todas as páginas até agora) para a pesquisa atual. */
type Loaded = { key: string; origin: string; items: RemoteOption[]; total: number; page: number; error?: boolean };

/** A que distância do fim da lista (em px) a próxima página começa a carregar. */
const LOAD_MORE_DISTANCE = 48;

const DEBOUNCE_MS = 300;

/** Seletor com busca cujas opções vêm da API (`fetchOptions`), sem baixar a lista inteira. */
export function RemoteComboBox({
    fetchOptions,
    value,
    onValueChange,
    selectedLabel,
    placeholder = "Digite para pesquisar",
    emptyMessage = "Nenhum resultado encontrado!",
    pageSize = 10,
    clearable = false,
    disabled = false,
    reloadKey,
}: RemoteComboBoxProps) {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<RemoteOption | null>(value ? { value, label: selectedLabel ?? value } : null);
    const [inputValue, setInputValue] = useState(selected?.label ?? "");
    const [typed, setTyped] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [loaded, setLoaded] = useState<Loaded | null>(null);

    // A escolha mais recente, para o fechamento da lista (no mesmo clique que escolhe a opção) já enxergá-la.
    const selectedRef = useRef<RemoteOption | null>(selected);
    useEffect(() => {
        selectedRef.current = selected;
    }, [selected]);

    // O pai trocou o valor (limpou o formulário, abriu outro registro): acompanha, sem esperar a lista.
    if (value === "" && selected) {
        setSelected(null);
        setInputValue("");
    } else if (value !== "" && selected?.value !== value) {
        const next = { value, label: selectedLabel ?? value };
        setSelected(next);
        setInputValue(next.label);
    }

    // O texto digitado só vira consulta depois de uma pausa.
    useEffect(() => {
        const timer = window.setTimeout(() => setSearch(typed.trim()), typed.trim() === "" ? 0 : DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [typed]);

    // Texto novo ou outra origem de dados: volta para a página 1 (ajuste na renderização).
    const resetKey = `${search}|${reloadKey ?? ""}`;
    const [lastResetKey, setLastResetKey] = useState(resetKey);
    if (lastResetKey !== resetKey) {
        setLastResetKey(resetKey);
        setPage(1);
    }
    const currentPage = lastResetKey !== resetKey ? 1 : page;

    // "origem" = o que define o conteúdo da lista (texto pesquisado, fonte, tamanho). Mudou? Recomeça da página 1.
    const origin = `${search}|${reloadKey ?? ""}|${pageSize}`;
    const key = `${currentPage}|${origin}`;

    // Só consulta a API com a lista aberta. Cada página nova é ACRESCENTADA às anteriores.
    useEffect(() => {
        if (!open) return;
        let cancelled = false;

        fetchOptions({ page: currentPage, pageSize, q: search })
            .then((data) => {
                if (cancelled) return;
                setLoaded((previous) => {
                    const keep = previous && previous.origin === origin && data.page > 1 ? previous.items : [];
                    const known = new Set(keep.map((option) => option.value));
                    const items = [...keep, ...data.items.filter((option) => !known.has(option.value))];
                    return { key, origin, items, total: data.total, page: data.page };
                });
            })
            .catch((error) => {
                if (cancelled || isSessionExpiredError(error)) return;
                console.error(error);
                setLoaded((previous) => ({
                    key,
                    origin,
                    items: previous?.origin === origin ? previous.items : [],
                    total: previous?.origin === origin ? previous.total : 0,
                    page: previous?.page ?? 1,
                    error: true,
                }));
            });

        return () => {
            cancelled = true;
        };
        // `key` resume página, busca, origem e tamanho; `fetchOptions` costuma ser recriada a cada renderização.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, key]);

    const items = loaded?.items ?? [];
    const total = loaded?.total ?? 0;
    const fetching = open && loaded?.key !== key;
    // Só enquanto a lista mostra a pesquisa atual: ao digitar, a lista antiga some assim que a nova chega.
    const hasMore = !!loaded && !loaded.error && loaded.origin === origin && items.length < total;

    // Chegou perto do fim da lista: pede a próxima página (uma de cada vez).
    const handleScroll = (event: React.UIEvent<HTMLElement>) => {
        if (!hasMore || fetching) return;
        const list = event.currentTarget;
        if (list.scrollHeight - list.scrollTop - list.clientHeight <= LOAD_MORE_DISTANCE) setPage((loaded?.page ?? currentPage) + 1);
    };

    return (
        <Combobox<RemoteOption>
            items={items}
            filter={null}
            value={selected}
            open={open}
            inputValue={inputValue}
            disabled={disabled}
            itemToStringLabel={(option) => option.label}
            isItemEqualToValue={(a, b) => a.value === b.value}
            onValueChange={(option) => {
                selectedRef.current = option ?? null;
                setSelected(option ?? null);
                setInputValue(option?.label ?? "");
                onValueChange(option?.value ?? "", option ?? null);
            }}
            onInputValueChange={(text, details) => {
                setInputValue(text);
                // Só o que o usuário digita é pesquisa; preencher o campo com o nome escolhido não é.
                if (details.reason === "input-change") setTyped(text);
                else if (details.reason !== "none") setTyped("");
            }}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) {
                    setTyped("");
                    setPage(1);
                    setInputValue(selectedRef.current?.label ?? "");
                }
            }}
        >
            <ComboboxInput placeholder={placeholder} showClear={clearable && !!selected} disabled={disabled} />

            <ComboboxContent>
                {fetching && items.length === 0 ? (
                    <p className="px-3 py-2 text-center text-sm text-muted-foreground" role="status">
                        Carregando…
                    </p>
                ) : loaded?.error && items.length === 0 ? (
                    <p className="px-3 py-2 text-center text-sm text-destructive" role="alert">
                        Não foi possível carregar as opções.
                    </p>
                ) : (
                    <>
                        <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>

                        <ComboboxList onScroll={handleScroll} className={fetching && loaded?.origin !== origin ? "opacity-60 transition-opacity" : undefined}>
                            {(option: RemoteOption) => (
                                <ComboboxItem key={option.value} value={option}>
                                    <span className="truncate">{option.label}</span>
                                    {option.hint && <span className="ml-2 truncate text-xs text-muted-foreground">{option.hint}</span>}
                                </ComboboxItem>
                            )}
                        </ComboboxList>
                    </>
                )}

                {/* Só informa o andamento: as próximas opções chegam sozinhas ao rolar a lista. */}
                {items.length > 0 && (total > pageSize || fetching) && (
                    <p className="border-t border-border px-3 py-1.5 text-center text-xs text-muted-foreground" aria-live="polite">
                        {fetching ? "Carregando mais…" : hasMore ? `${items.length} de ${total} · role para carregar mais` : `${total} ${total === 1 ? "resultado" : "resultados"}`}
                    </p>
                )}
            </ComboboxContent>
        </Combobox>
    );
}

"use client";

import { isSessionExpiredError } from "@/lib/apiFetcher";
import {
    KIND_LABELS,
    KIND_ORDER,
    highlightRanges,
    loadSearchEntries,
    searchEntries,
    type SearchEntry,
    type SearchKind,
    type SearchProfile,
} from "@/lib/globalSearch";
import {
    ArrowUpRight,
    Building2,
    ClipboardList,
    CornerDownLeft,
    LayoutDashboard,
    NotebookPen,
    Search,
    SearchX,
    ShieldCheck,
    UserRound,
    UsersRound,
    X,
    type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./global-search.css";

export type SearchPage = {
    href: string;
    label: string;
    icon: LucideIcon;
};

type GlobalSearchProps = {
    profile?: SearchProfile;
    /** Páginas do menu que o perfil pode abrir. */
    pages: SearchPage[];
    /** Menu lateral recolhido: mostra só o ícone no botão. */
    collapsed?: boolean;
};

const KIND_ICONS: Record<SearchKind, LucideIcon> = {
    page: LayoutDashboard,
    research: NotebookPen,
    collection: ClipboardList,
    researcher: UserRound,
    company: Building2,
    admin: ShieldCheck,
};

/** Inscrição que não faz nada (não há o que escutar). */
const noopSubscribe = () => () => { };
/** Texto do atalho da busca: ⌘ K no Mac e Ctrl K nos demais. */
const shortcutLabel = () => (/mac|iphone|ipad/i.test(navigator.userAgent) ? "⌘ K" : "Ctrl K");

/** Escreve o texto com os trechos que casam com a busca em destaque. */
function Highlight({ text, query }: { text: string; query: string }): ReactNode {
    const ranges = highlightRanges(text, query);
    if (ranges.length === 0) return text;

    const parts: ReactNode[] = [];
    let cursor = 0;
    ranges.forEach(([start, end], i) => {
        if (start > cursor) parts.push(<Fragment key={`t${i}`}>{text.slice(cursor, start)}</Fragment>);
        parts.push(<mark key={`m${i}`}>{text.slice(start, end)}</mark>);
        cursor = end;
    });
    if (cursor < text.length) parts.push(<Fragment key="rest">{text.slice(cursor)}</Fragment>);
    return parts;
}

/**
 * Buscador global do painel. Abre pelo botão do menu, por Ctrl/Cmd + K ou pela tecla "/",
 * e encontra páginas, pesquisas, pesquisadores, empresas e administradores só de digitar.
 */
export function GlobalSearch({ profile, pages, collapsed = false }: GlobalSearchProps) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    // No servidor (e na hidratação) usa "Ctrl K"; no navegador troca para ⌘ K no Mac.
    const shortcut = useSyncExternalStore(noopSubscribe, shortcutLabel, () => "Ctrl K");

    const close = useCallback(() => {
        setOpen(false);
        triggerRef.current?.focus();
    }, []);

    useEffect(() => {
        if (!profile) return;

        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setOpen((value) => !value);
                return;
            }
            if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
                const target = event.target as HTMLElement | null;
                const typing =
                    !!target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));
                if (typing) return;
                event.preventDefault();
                setOpen(true);
            }
        };

        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [profile]);

    if (!profile) return null;

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className="pa-gs-trigger"
                onClick={() => setOpen(true)}
                aria-label="Abrir busca global"
                aria-haspopup="dialog"
                aria-expanded={open}
                title={collapsed ? `Buscar (${shortcut})` : undefined}
            >
                <Search strokeWidth={1.7} aria-hidden="true" />
                <span className="l">Buscar…</span>
                <kbd className="k">{shortcut}</kbd>
            </button>
            {open &&
                createPortal(
                    <SearchPanel
                        profile={profile}
                        pages={pages}
                        onClose={close}
                        onNavigate={(href) => {
                            setOpen(false);
                            router.push(href);
                        }}
                    />,
                    document.body
                )}
        </>
    );
}

type SearchPanelProps = {
    profile: SearchProfile;
    pages: SearchPage[];
    onClose: () => void;
    onNavigate: (href: string) => void;
};

/** Painel aberto: é montado a cada abertura, então começa sempre limpo. */
function SearchPanel({ profile, pages, onClose, onNavigate }: SearchPanelProps) {
    const [query, setQuery] = useState("");
    const [records, setRecords] = useState<SearchEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [active, setActive] = useState(0);

    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const listId = useId();

    /* ---------- busca os registros no servidor (poucos por tipo, depois de uma pausa na digitação) ---------- */
    const searched = query.trim();
    useEffect(() => {
        let cancelled = false;

        const timer = window.setTimeout(() => {
            loadSearchEntries(profile, searched)
                .then((entries) => {
                    if (!cancelled) {
                        setRecords(entries);
                        setFailed(false);
                    }
                })
                .catch((error) => {
                    if (cancelled || isSessionExpiredError(error)) return;
                    console.error(error);
                    setFailed(true);
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
        }, searched ? 250 : 0);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [profile, searched]);

    /* ---------- foco e rolagem da página ---------- */
    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        inputRef.current?.focus();
        return () => {
            document.body.style.overflow = previous;
        };
    }, []);

    /* ---------- resultados ---------- */
    const pageEntries = useMemo<SearchEntry[]>(
        () =>
            pages.map(({ href, label }) => ({
                key: `page:${href}`,
                kind: "page",
                title: label,
                subtitle: href === "/" ? "Painel principal" : undefined,
                href,
            })),
        [pages]
    );

    const iconByKey = useMemo(() => new Map(pages.map((p) => [`page:${p.href}`, p.icon])), [pages]);

    const trimmed = query.trim();

    const results = useMemo(() => {
        if (trimmed) return searchEntries([...pageEntries, ...records], trimmed).map((r) => r.entry);
        // Sem texto: as páginas e algumas pesquisas, para o usuário já ter por onde começar.
        const recent = records.filter((r) => r.kind === "research").slice(0, 4);
        return [...pageEntries, ...recent];
    }, [trimmed, pageEntries, records]);

    const groups = useMemo(
        () =>
            KIND_ORDER.map((kind) => ({
                kind,
                items: results.filter((entry) => entry.kind === kind),
            })).filter((group) => group.items.length > 0),
        [results]
    );

    // Índice de cada resultado na lista contínua (para a navegação por setas).
    const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

    // A seleção nunca passa do último resultado, mesmo quando a lista encolhe.
    const current = Math.min(active, Math.max(0, flat.length - 1));

    useEffect(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
    }, [current]);

    const choose = (entry: SearchEntry | undefined) => {
        if (entry) onNavigate(entry.href);
    };

    const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive(flat.length ? (current + 1) % flat.length : 0);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(flat.length ? (current - 1 + flat.length) % flat.length : 0);
        } else if (event.key === "Home") {
            event.preventDefault();
            setActive(0);
        } else if (event.key === "End") {
            event.preventDefault();
            setActive(Math.max(0, flat.length - 1));
        } else if (event.key === "Enter") {
            event.preventDefault();
            choose(flat[current]);
        } else if (event.key === "Escape") {
            event.preventDefault();
            if (query) {
                setQuery("");
                setActive(0);
            } else onClose();
        } else if (event.key === "Tab") {
            // Mantém o foco no campo enquanto o painel está aberto.
            event.preventDefault();
        }
    };

    const optionId = (index: number) => `${listId}-opt-${index}`;

    const panel = (
        <div
            className="pa-gs-back"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="pa-gs" role="dialog" aria-modal="true" aria-label="Busca global">
                <div className="pa-gs-bar">
                    <Search aria-hidden="true" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setActive(0);
                        }}
                        onKeyDown={onInputKeyDown}
                        placeholder="Buscar páginas, pesquisas, coletas, pessoas…"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        role="combobox"
                        aria-expanded="true"
                        aria-controls={listId}
                        aria-autocomplete="list"
                        aria-activedescendant={flat.length ? optionId(current) : undefined}
                        aria-label="Digite o que você procura"
                    />
                    {query && (
                        <button
                            type="button"
                            className="pa-gs-clear"
                            onClick={() => {
                                setQuery("");
                                setActive(0);
                                inputRef.current?.focus();
                            }}
                            aria-label="Limpar busca"
                        >
                            <X />
                        </button>
                    )}
                    <kbd className="pa-gs-esc" onClick={onClose}>Esc</kbd>
                </div>

                <div ref={listRef} id={listId} role="listbox" className="pa-gs-list" aria-label="Resultados">
                    {groups.map((group) => {
                        return (
                            <div key={group.kind} role="group" aria-label={KIND_LABELS[group.kind]} className="pa-gs-group">
                                <p className="pa-gs-gh">
                                    {KIND_LABELS[group.kind]}
                                </p>
                                {group.items.map((entry) => {
                                    const index = flat.indexOf(entry);
                                    const Icon = iconByKey.get(entry.key) ?? KIND_ICONS[entry.kind];
                                    return (
                                        <div
                                            key={entry.key}
                                            id={optionId(index)}
                                            data-index={index}
                                            role="option"
                                            aria-selected={index === current}
                                            className={`pa-gs-item ${index === current ? "on" : ""}`}
                                            onMouseMove={() => current !== index && setActive(index)}
                                            onClick={() => choose(entry)}
                                        >
                                            <span className={`pa-gs-ic k-${entry.kind}`}>
                                                <Icon strokeWidth={1.7} aria-hidden="true" />
                                            </span>
                                            <span className="pa-gs-tx">
                                                <b><Highlight text={entry.title} query={trimmed} /></b>
                                                {entry.subtitle && (
                                                    <span><Highlight text={entry.subtitle} query={trimmed} /></span>
                                                )}
                                            </span>
                                            {entry.badge && (
                                                <span className={`pa-gs-badge ${entry.badgeTone ?? ""}`}>{entry.badge}</span>
                                            )}
                                            <ArrowUpRight className="pa-gs-go" aria-hidden="true" />
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}

                    {flat.length === 0 && (
                        <div className="pa-gs-empty" role="status">
                            {loading ? (
                                <p>Procurando…</p>
                            ) : (
                                <>
                                    <SearchX aria-hidden="true" />
                                    <p>Nada encontrado para “{trimmed}”</p>
                                    <span>Confira a grafia ou tente uma palavra só.</span>
                                </>
                            )}
                        </div>
                    )}

                    {failed && (
                        <p className="pa-gs-note" role="alert">
                            Não foi possível carregar todos os dados. Os resultados podem estar incompletos.
                        </p>
                    )}
                    {loading && flat.length > 0 && <p className="pa-gs-note" role="status">Carregando mais resultados…</p>}
                </div>

                <div className="pa-gs-foot" aria-hidden="true">
                    <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
                    <span><kbd><CornerDownLeft /></kbd> abrir</span>
                    <span><kbd>Esc</kbd> fechar</span>
                    <span className="r"><UsersRound /> {records.length} {records.length === 1 ? "registro" : "registros"}</span>
                </div>
            </div>
        </div>
    );

    return panel;
}

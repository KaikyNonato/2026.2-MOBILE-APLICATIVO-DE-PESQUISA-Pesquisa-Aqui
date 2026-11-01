'use client'

import BannerComponent from "@/components/ui/bannerComponent";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Contour } from "@/components/ui/contour";
import DialogLayout from "@/components/ui/dialogLayout";
import { TableSearch, TableViewControls, useTableView, type TableView } from "@/components/ui/data-table";
import { LoadingState } from "@/components/ui/loadingState";
import { ServerPagination } from "@/components/ui/pagination";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePagedResource } from "@/hooks/usePagedResource";
import { isSessionExpiredError } from "@/lib/apiFetcher";
import type { Research } from "@/lib/research";
import { deleteResearch, getResearchesPage, getResearchSummary, publishResearch, unpublishResearch, type ResearchListItem, type ResearchSummary } from "@/lib/research";
import type { UserItem } from "@/lib/user";
import { ArrowDownAZ, CalendarClock, LibraryBig, Plus, SearchX, Timer } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import ModelosPesquisa from "./components/ModelosPesquisa";
import CadastrarPesquisaForm from "./components/CadastrarPesquisaForm";
import CalendarioCampo, { type LegendItem } from "./components/CalendarioCampo";
import MinhasPesquisas from "./components/MinhasPesquisas";
import PesquisaCard from "./components/PesquisaCard";
import PesquisaLinha, { ListaPesquisas } from "./components/PesquisaLinha";
import type { Filter } from "./components/pesquisaView";
import "./pesquisas.css";

type Sort = "recent" | "name" | "deadline";

const FILTERS: { value: Filter; label: string; kind: LegendItem["kind"] }[] = [
    { value: "ALL", label: "Todas", kind: "all" },
    { value: "IN_FIELD", label: "Em campo", kind: "live" },
    { value: "PUBLISHED", label: "Publicadas", kind: "pub" },
    { value: "DRAFT", label: "Rascunhos", kind: "draft" },
    { value: "CLOSED", label: "Encerradas", kind: "closed" },
];

const PAGE_SIZES = [12, 24, 48, 96];

function PesquisasAdmin() {
    const [summary, setSummary] = useState<ResearchSummary | null>(null);
    const [filter, setFilter] = useState<Filter>("ALL");
    const [sort, setSort] = useState<Sort>("recent");
    const [view, setView] = useTableView("cards");
    const [now] = useState(() => Date.now());

    // A API devolve uma página por vez (situação, busca e ordem são feitas lá): nunca chegam todas as pesquisas.
    const list = usePagedResource<ResearchListItem>(
        (params) => getResearchesPage({ ...params, status: filter === "ALL" ? undefined : filter, sort }),
        { pageSize: 12, filters: { filter, sort } },
    );
    const { reload } = list;
    const query = list.search;
    const setQuery = list.setSearch;
    const loading = list.loading;
    const error = list.error;
    const visible = list.items;
    const researches = visible;

    // Contagem por situação (legenda) e total de coletas, sem listar as pesquisas.
    const loadSummary = useCallback(() => {
        getResearchSummary()
            .then(setSummary)
            .catch((err) => {
                if (!isSessionExpiredError(err)) console.error(err);
            });
    }, []);

    useEffect(() => {
        loadSummary();
    }, [loadSummary]);

    const forceRefresh = useCallback(() => {
        reload();
        loadSummary();
    }, [reload, loadSummary]);

    const counts = useMemo(
        () => ({
            ALL: summary?.total ?? 0,
            DRAFT: summary?.byStatus.DRAFT ?? 0,
            PUBLISHED: summary?.byStatus.PUBLISHED ?? 0,
            IN_FIELD: summary?.byStatus.IN_FIELD ?? 0,
            CLOSED: summary?.byStatus.CLOSED ?? 0,
        }) as Record<Filter, number>,
        [summary],
    );

    const collectionsByResearch = useMemo(() => new Map(visible.map((r) => [r.id, r.collected])), [visible]);

    // "Publicadas" só aparece na legenda quando existe alguma (ou quando é o filtro escolhido).
    const legend: LegendItem[] = FILTERS.filter((f) => f.value !== "PUBLISHED" || counts.PUBLISHED > 0 || filter === "PUBLISHED").map((f) => ({
        ...f,
        count: summary ? counts[f.value] : null,
    }));

    /* ---------- ações (publicar e excluir pedem confirmação) ---------- */

    const handleDelete = async (id: number) => {
        const item = researches.find((r) => r.id === id);
        const confirmed = await confirmDialog({
            title: "Excluir pesquisa",
            description: `Tem certeza que deseja excluir a pesquisa "${item?.title ?? id}"? Esta ação não pode ser desfeita.`,
            confirmLabel: "Excluir",
            variant: "destructive",
        });
        if (!confirmed) return;

        try {
            await deleteResearch(id);
            forceRefresh();
            toast.success("Pesquisa excluída com sucesso!");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao excluir pesquisa");
        }
    };

    const handlePublish = async (id: number) => {
        const item = researches.find((r) => r.id === id);
        const confirmed = await confirmDialog({
            title: "Publicar pesquisa",
            description: `Publicar "${item?.title ?? id}"? Depois que um pesquisador baixar a pesquisa, ela não poderá mais ser excluída.`,
            confirmLabel: "Publicar",
        });
        if (!confirmed) return;

        try {
            const updated = await publishResearch(id);
            list.mutate((items) => items.map((r) => (r.id === id ? { ...r, status: updated.status } : r)));
            loadSummary();
            toast.success("Pesquisa publicada com sucesso!");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao publicar pesquisa");
        }
    };

    const handleUnpublish = async (id: number) => {
        const item = researches.find((r) => r.id === id);
        const confirmed = await confirmDialog({
            title: "Voltar para rascunho",
            description: `Voltar "${item?.title ?? id}" para rascunho? Ela deixa de ficar visível para o aplicativo e volta a poder ser editada.`,
            confirmLabel: "Voltar para rascunho",
        });
        if (!confirmed) return;

        try {
            const updated = await unpublishResearch(id);
            list.mutate((items) => items.map((r) => (r.id === id ? { ...r, status: updated.status } : r)));
            loadSummary();
            toast.success("Pesquisa voltou para rascunho!");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao voltar a pesquisa para rascunho");
        }
    };

    const handleUpdated = (updated: Research) => {
        list.mutate((items) => items.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
        reload();
    };

    const itemProps = (research: ResearchListItem) => ({
        research,
        team: research.team.map((u): UserItem => ({ ...u, profile: "RESEARCHER", companyId: research.companyId ?? null })),
        collections: research.collected,
        teamLoading: false,
        now,
        onPublish: handlePublish,
        onUnpublish: handleUnpublish,
        onDelete: handleDelete,
        onUpdated: handleUpdated,
    });

    const clearFilters = () => {
        setQuery("");
        setFilter("ALL");
    };

    return (
        <section className="pa-pesq flex flex-col gap-6">
            <BannerComponent
                title="Pesquisas"
                description="Monte questionários, publique para o campo e acompanhe cada pesquisa."
                actions={
                    <div className="flex flex-wrap gap-2">
                        <DialogLayout
                            triggerButtonSize="default"
                            triggerButtonVariant="outline"
                            dialogTrigger={<><LibraryBig />Usar modelo</>}
                            dialogTitle="Modelos de pesquisa"
                            dialogDescription="Questionários prontos, com seções, questões e regras. Escolha um e ajuste depois."
                            dialogContent={(close) => <ModelosPesquisa onClose={close} />}
                        />
                        <DialogLayout
                            triggerButtonSize="default"
                            dialogTrigger={<><Plus />Nova pesquisa</>}
                            dialogTitle="Nova pesquisa"
                            dialogDescription="Informe os dados principais. As questões entram na próxima etapa."
                            dialogContent={<CadastrarPesquisaForm onSuccess={forceRefresh} />}
                        />

                    </div>
                }
            />

            {/* Calendário de campo: também é o filtro de situação */}
            <CalendarioCampo
                rows={visible}
                all={visible}
                legend={legend}
                filter={filter}
                onFilter={setFilter}
                now={now}
                loading={loading}
                collectionsByResearch={collectionsByResearch}
                collectionsReady={!loading}
                totalCollections={summary?.collections}
            />

            {/* Ferramentas */}
            <div className="pq-tools introduction-card">
                <TableSearch
                    value={query}
                    onChange={setQuery}
                    placeholder="Buscar por título, objetivo ou público..."
                    label="Buscar pesquisas"
                />
                {!loading && <span className="pq-found">{list.total} {list.total === 1 ? "pesquisa" : "pesquisas"}</span>}
                <div className="grow">
                    <TableViewControls<Sort>
                        sort={sort}
                        onSortChange={setSort}
                        view={view}
                        onViewChange={setView}
                        onRefresh={forceRefresh}
                        refreshing={list.fetching}
                        sortOptions={[
                            { value: "recent", label: "Recentes", icon: <CalendarClock /> },
                            { value: "name", label: "A-Z", icon: <ArrowDownAZ /> },
                            { value: "deadline", label: "Prazo", icon: <Timer /> },
                        ]}
                    />
                </div>
            </div>

            {error && <p role="alert" className="text-sm text-destructive">Erro: {error}</p>}

            {loading ? (
                <LoadingState label="Carregando pesquisas..." shape={view === "table" ? "table" : "research-cards"} columns={5} />
            ) : visible.length === 0 ? (
                <div className="pq-empty">
                    <Contour seed={1.9} rings={9} cx={0.5} cy={0.5} size={1} width={600} height={260} />
                    <SearchX aria-hidden="true" />
                    {(summary?.total ?? 0) === 0 && filter === "ALL" && !query.trim() ? (
                        <>
                            <b>Nenhuma pesquisa ainda</b>
                            Crie a primeira com &quot;Nova pesquisa&quot; e ela aparece aqui.
                        </>
                    ) : (
                        <>
                            <b>Nada encontrado</b>
                            Nenhuma pesquisa combina com a busca e a situação escolhidas.
                            <div className="pq-empty-act">
                                <Button variant="outline" size="sm" onClick={clearFilters}>Limpar filtros</Button>
                            </div>
                        </>
                    )}
                </div>
            ) : view === "table" ? (
                <div className="pa-dt-root" data-fetching={list.fetching || undefined}>
                    <ListaPesquisas>
                        {visible.map((research) => (
                            <PesquisaLinha key={research.id} {...itemProps(research)} />
                        ))}
                    </ListaPesquisas>
                    <ServerPagination server={list.server} label="Pesquisas" pageSizeOptions={PAGE_SIZES} />
                </div>
            ) : (
                <div className="pa-dt-root" data-fetching={list.fetching || undefined}>
                    <div className="pq-grid">
                        {visible.map((research) => (
                            <PesquisaCard key={research.id} {...itemProps(research)} />
                        ))}
                    </div>
                    <ServerPagination server={list.server} label="Pesquisas" pageSizeOptions={PAGE_SIZES} />
                </div>
            )}
        </section>
    );
}

/** O administrador gerencia as pesquisas; o pesquisador só consulta as dele (a coleta é no aplicativo). */
export default function Pesquisas() {
    const { user, loading } = useCurrentUser();

    if (loading) return <LoadingState label="Carregando pesquisas..." shape="research-cards" />;
    if (user?.profile === "RESEARCHER") return <MinhasPesquisas />;

    return <PesquisasAdmin />;
}

import { UserAvatar } from "@/components/ui/user-avatar";
import { usePagedResource } from "@/hooks/usePagedResource";
import { getResearchesPage, type Research, type ResearchListItem } from "@/lib/research";
import {
    CellTitle,
    DataTable,
    DataTableHeader,
    DataTableToolbar,
    Muted,
    RowActions,
    RowLink,
    TableChip,
    TableEmpty,
    TableSearch,
    TableViewControls,
    type DataColumn,
    type TableSort,
    type TableView,
    useTableView,
} from "@/components/ui/data-table";
import {
    avatarTone,
    daysUntilEnd,
    formatPeriod,
    periodProgress,
} from "@/lib/fieldData";
import { useState } from "react";

type PesquisasEquipeTabelaProps = {
    now: number;
};

const SEGMENTS = 20;
const MAX_AVATARS = 3;

type Situation = { label: string; tone: "light" | "clay" | "gray"; endingSoon: boolean };

/** Cor do selo na tabela padrão para cada tom de situação. */
const CHIP_TONE = { light: "live", clay: "soon", gray: "done" } as const;

/** Situação da pesquisa na tabela da equipe: rótulo, cor e se encerra em breve. */
export function situationOf(research: Research, now: number): Situation {
    if (research.status === "DRAFT") return { label: "Rascunho", tone: "gray", endingSoon: false };
    if (research.status === "CLOSED") return { label: "Encerrada", tone: "gray", endingSoon: false };

    const days = daysUntilEnd(research.endDate, now);
    if (days !== null && days < 0) return { label: "Prazo encerrado", tone: "gray", endingSoon: false };
    if (days !== null && days <= 7) {
        const label = days === 0 ? "Encerra hoje" : days === 1 ? "Encerra amanhã" : `Encerra em ${days} dias`;
        return { label, tone: "clay", endingSoon: true };
    }
    return { label: research.status === "IN_FIELD" ? "Em campo" : "Publicada", tone: "light", endingSoon: false };
}

/** Tabela de pesquisas do painel: período, equipe, situação e andamento. A API entrega uma página por vez. */
export default function PesquisasEquipeTabela({ now }: PesquisasEquipeTabelaProps) {
    const [sort, setSort] = useState<TableSort>("recent");
    const [view, setView] = useTableView("cards");

    const list = usePagedResource<ResearchListItem>(
        (params) => getResearchesPage({ ...params, sort }),
        { pageSize: 10, filters: { sort } },
    );
    const { search, setSearch } = list;
    const loading = list.loading;
    const researches = list.items;
    const rows = list.items;
    const term = search.trim();

    const columns: DataColumn<ResearchListItem>[] = [
        {
            id: "title",
            header: "Pesquisa",
            minWidth: "14rem",
            cell: (research) => {
                const done = research.collected;
                return (
                    <CellTitle
                        title={research.title}
                        href={`/pesquisas/${research.id}`}
                        sub={
                            <>
                                {formatPeriod(research.startDate, research.endDate, new Date(now))}
                                {research.status !== "DRAFT" && ` · ${done} ${done === 1 ? "coleta" : "coletas"}`}
                            </>
                        }
                    />
                );
            },
        },
        {
            id: "team",
            header: "Equipe",
            cell: (research) => {
                const team = research.team;
                if (team.length === 0) return <span title="Nenhum pesquisador vinculado"><Muted>Sem equipe</Muted></span>;
                return (
                    <div className="pa-stack" title={team.map((u) => u.name).join(", ")}>
                        {team.slice(0, MAX_AVATARS).map((u) => (
                            <UserAvatar key={u.id} name={u.name} src={u.avatarUrl} size={32} className={`avatar-pa ${avatarTone(u.id)}`} />
                        ))}
                        {team.length > MAX_AVATARS && <div className="avatar-pa more">+{team.length - MAX_AVATARS}</div>}
                    </div>
                );
            },
        },
        {
            id: "status",
            header: "Situação",
            cell: (research) => {
                const situation = situationOf(research, now);
                return <TableChip tone={CHIP_TONE[situation.tone]}>{situation.label}</TableChip>;
            },
        },
        {
            id: "progress",
            header: "Período decorrido",
            cell: (research) => {
                const situation = situationOf(research, now);
                const progress = periodProgress(research, now);
                const filled = Math.round(progress * SEGMENTS);
                const pct = Math.round(progress * 100);
                return (
                    <div className="pa-seg-wrap" role="img" aria-label={`${pct}% do período decorrido`}>
                        <div className="pa-seg" aria-hidden="true">
                            {Array.from({ length: SEGMENTS }).map((_, i) => (
                                <i key={i} className={i < filled ? (situation.endingSoon ? "c" : "f") : ""} />
                            ))}
                        </div>
                        <span className="pct">{pct}%</span>
                    </div>
                );
            },
        },
        {
            id: "actions",
            header: "Ações",
            hideHeader: true,
            align: "right",
            cell: (research) => (
                <RowActions>
                    <RowLink href={`/pesquisas/${research.id}`}>Abrir</RowLink>
                </RowActions>
            ),
        },
    ];

    return (
        <div>
            <DataTableHeader title="Pesquisas cadastradas" count={loading ? undefined : list.total} />

            {!loading && (list.total > 0 || term) && (
                <DataTableToolbar>
                    <TableSearch value={search} onChange={setSearch} placeholder="Buscar por título ou público..." label="Buscar pesquisas" />
                    <div className="grow flex flex-wrap items-center gap-2">
                        <TableViewControls sort={sort} onSortChange={setSort} view={view} onViewChange={setView} onRefresh={list.reload} refreshing={list.fetching} />
                    </div>
                </DataTableToolbar>
            )}

            <DataTable
                label="Pesquisas cadastradas"
                columns={columns}
                rows={rows}
                getRowKey={(research) => research.id}
                loading={loading}
                loadingLabel="Carregando pesquisas..."
                view={view}
                server={list.server}
                empty={
                    !term ? (
                        <TableEmpty title="Nenhuma pesquisa cadastrada." text='Use "Nova pesquisa" para começar.' />
                    ) : (
                        <TableEmpty title="Nenhuma pesquisa encontrada" text="Tente outro título ou público." onClear={() => setSearch("")} />
                    )
                }
            />
        </div>
    );
}

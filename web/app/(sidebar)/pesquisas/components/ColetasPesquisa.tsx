'use client';

import { UserAvatar } from "@/components/ui/user-avatar";
import { CountUp } from "@/components/ui/count-up";
import { Button } from "@/components/ui/button";
import { Contour } from "@/components/ui/contour";
import {
    CellTitle,
    DataTable,
    DataTableHeader,
    DataTableToolbar,
    RowActions,
    TableChip,
    TableEmpty,
    TableFilters,
    TableSearch,
    TableViewControls,
    type DataColumn,
    type TableSort,
    type TableView,
    useTableView,
} from "@/components/ui/data-table";
import { Spinner } from "@/components/ui/spinner";
import { LoadingState } from "@/components/ui/loadingState";
import { usePagedResource } from "@/hooks/usePagedResource";
import { formatDuration, getCollection, getCollectionAudio, getCollectionsPage, getCollectionStats, type CollectionStats, type CollectionSummary } from "@/lib/collection";
import { Clock, FileText, Headphones, Play, ShieldAlert, Inbox, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useBusySet } from "@/hooks/useBusySet";
import toast from "react-hot-toast";
import RespostasColeta from "./RespostasColeta";

type Filter = 'ALL' | 'AUDIO' | 'NO_AUDIO';

const TONES = [
    'bg-[#cfe3d8] text-[#1f3a2f]',
    'bg-[#f0d5cb] text-[#7a3b29]',
    'bg-[#dfe6ef] text-[#2a3d57]',
    'bg-[#e6e0cc] text-[#5b4d1c]',
];

/** Escolhe uma cor de avatar a partir do nome (sempre a mesma para o mesmo nome). */
const toneOfName = (name?: string | null) =>
    TONES[[...(name ?? '?')].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % TONES.length];

/** Converte uma data ISO em milissegundos (0 se vazia). */
const timeOf = (value: string | null) => (value ? new Date(value).getTime() : 0) || 0;

/** Formata a hora como hh:mm (`-` se vazia). */
const formatTime = (value: string | null) =>
    value ? new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-';

/** Formata um tamanho em bytes como KB ou MB. */
const formatSize = (bytes: number) =>
    bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Códigos de erro do elemento <audio> (MediaError.code)
const AUDIO_ERRORS: Record<number, string> = {
    1: 'O carregamento do áudio foi interrompido.',
    2: 'Falha de rede ao carregar o áudio.',
    3: 'O navegador não conseguiu decodificar o áudio: o arquivo pode estar incompleto ou corrompido.',
    4: 'O navegador não reconhece o formato deste áudio.',
};

interface ColetasPesquisaProps {
    researchId: number;
    recordInterview: boolean;
    /** Abre esta coleta assim que a lista carregar (vem do buscador global). */
    openCollectionId?: number;
}

/**
 * Aba de coletas da pesquisa: carrega a lista e controla filtro, ordem, visualização e o player de
 * áudio.
 */
export default function ColetasPesquisa({ researchId, recordInterview, openCollectionId }: ColetasPesquisaProps) {
    const loadingAudio = useBusySet<number>();
    // Só a resposta do último "Ouvir" clicado pode abrir o player (respostas antigas são descartadas).
    const lastListenRef = useRef(0);
    const [viewing, setViewing] = useState<CollectionSummary | null>(null);
    const [filter, setFilter] = useState<Filter>('ALL');
    const [sort, setSort] = useState<TableSort>('recent');
    const [view, setView] = useTableView('cards');
    const [now] = useState(() => Date.now());
    const [stats, setStats] = useState<CollectionStats | null>(null);
    const [player, setPlayer] = useState<{
        collectionId: number;
        url: string;
        sizeBytes: number;
        error: string | null;
    } | null>(null);

    // A API devolve uma página por vez (busca, gravação e ordem são feitas lá): nunca chegam todas as coletas.
    const list = usePagedResource<CollectionSummary>(
        (params) => getCollectionsPage(researchId, { ...params, audio: filter === 'ALL' ? undefined : filter, sort }),
        { pageSize: 10, filters: { filter, sort, researchId } },
    );

    // Os quatro indicadores vêm prontos do servidor.
    useEffect(() => {
        let cancelled = false;
        getCollectionStats(researchId)
            .then((data) => { if (!cancelled) setStats(data); })
            .catch((err) => console.error(err));
        return () => { cancelled = true; };
    }, [researchId]);

    // Abre a coleta pedida pelo buscador global (ela pode estar em qualquer página).
    useEffect(() => {
        if (openCollectionId === undefined) return;
        let cancelled = false;
        getCollection(openCollectionId)
            .then((detail) => { if (!cancelled) setViewing(detail); })
            .catch((err) => console.error(err));
        return () => { cancelled = true; };
    }, [openCollectionId]);

    // Libera o arquivo em memória quando o player troca ou a tela fecha.
    useEffect(() => {
        return () => { if (player) URL.revokeObjectURL(player.url); };
    }, [player]);

    const handleListen = async (collectionId: number) => {
        const request = ++lastListenRef.current;
        loadingAudio.start(collectionId);
        try {
            const blob = await getCollectionAudio(collectionId);
            if (request !== lastListenRef.current) return;
            setPlayer({ collectionId, url: URL.createObjectURL(blob), sizeBytes: blob.size, error: null });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Erro ao carregar o áudio');
        } finally {
            loadingAudio.stop(collectionId);
        }
    };

    if (list.loading) {
        return <LoadingState label="Carregando coletas..." shape={view === "table" ? "table" : "collections"} columns={5} />;
    }

    if (list.error && list.items.length === 0) {
        if (list.errorStatus === 403) {
            return (
                <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                    <ShieldAlert className="h-8 w-8 text-destructive" />
                    <p className="max-w-md text-sm">{list.error}</p>
                </div>
            );
        }

        return (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
                <p className="font-medium">Erro ao carregar as coletas</p>
                <p>{list.error}</p>
            </div>
        );
    }

    return (
        <ColetasView
            list={list}
            stats={stats}
            recordInterview={recordInterview}
            filter={filter}
            setFilter={setFilter}
            sort={sort}
            setSort={setSort}
            view={view}
            setView={setView}
            now={now}
            loadingAudioIds={loadingAudio.ids}
            onListen={handleListen}
            onView={setViewing}
            viewing={viewing}
            onCloseView={() => setViewing(null)}
            player={player}
            onPlayerError={(message) => setPlayer((current) => (current ? { ...current, error: message } : current))}
        />
    );
}

type Player = { collectionId: number; url: string; sizeBytes: number; error: string | null } | null;

interface ColetasViewProps {
    list: ReturnType<typeof usePagedResource<CollectionSummary>>;
    stats: CollectionStats | null;
    recordInterview: boolean;
    filter: Filter;
    setFilter: (f: Filter) => void;
    sort: TableSort;
    setSort: (s: TableSort) => void;
    view: TableView;
    setView: (v: TableView) => void;
    now: number;
    loadingAudioIds: ReadonlySet<number>;
    onListen: (id: number) => void;
    onView: (c: CollectionSummary) => void;
    viewing: CollectionSummary | null;
    onCloseView: () => void;
    player: Player;
    onPlayerError: (message: string) => void;
}

/** Parte visual da aba de coletas: estatísticas, filtros, lista, respostas e player. */
function ColetasView({
    list, stats, recordInterview, filter, setFilter, sort, setSort, view, setView, now,
    loadingAudioIds, onListen, onView, viewing, onCloseView, player, onPlayerError,
}: ColetasViewProps) {
    const { search, setSearch } = list;
    const totalAll = stats?.total ?? list.total;
    const withAudio = stats?.withAudio ?? 0;
    const researchersCount = stats?.researchers ?? 0;
    const last = stats?.lastAt ? timeOf(stats.lastAt) : 0;
    const lastDays = last ? Math.max(0, Math.floor((now - last) / 86400000)) : null;
    const lastText =
        lastDays === null ? '—' : lastDays === 0 ? 'Hoje' : lastDays === 1 ? 'Ontem' : `${lastDays} dias`;
    const rows = list.items;
    const isFiltered = search.trim().length > 0 || filter !== 'ALL';

    const columns: DataColumn<CollectionSummary>[] = [
        {
            id: 'id',
            header: 'Coleta',
            cell: (c) => <CellTitle title={`#${c.id}`} />,
        },
        {
            id: 'researcher',
            header: 'Pesquisador',
            minWidth: '12rem',
            cell: (c) => (
                <div className="pa-dt-person">
                    <UserAvatar
                        name={c.researcherName ?? ''}
                        src={c.researcherAvatarUrl}
                        size={40}
                        ariaHidden
                        className={`avatar-pa pa-dt-av ${toneOfName(c.researcherName)}`}
                    />
                    <div className="tx"><b>{c.researcherName ?? '-'}</b></div>
                </div>
            ),
        },
        {
            id: 'when',
            header: 'Iniciada em',
            cell: (c) => (
                <div>
                    {c.startedAt ? new Date(c.startedAt).toLocaleDateString('pt-BR') : '-'}
                    <small>{formatTime(c.startedAt)}</small>
                </div>
            ),
        },
        {
            id: 'consent',
            header: 'Consentimento',
            cell: (c) =>
                c.consent.given ? (
                    <TableChip
                        tone="live"
                        title={`Consentimento em ${formatTime(c.consent.at)} por ${c.consent.confirmedByName ?? '-'}`}
                    >
                        Consentiu · {formatTime(c.consent.at)}
                    </TableChip>
                ) : (
                    <TableChip tone="done">Sem consentimento</TableChip>
                ),
        },
        {
            id: 'audio',
            header: 'Gravação',
            cell: (c) =>
                c.hasAudio ? (
                    <TableChip tone="soon">Gravada · {formatDuration(c.audioDurationSeconds)}</TableChip>
                ) : (
                    <TableChip tone="done">Sem gravação</TableChip>
                ),
        },
        {
            id: 'actions',
            header: 'Ações',
            hideHeader: true,
            align: 'right',
            cell: (c) => (
                <RowActions>
                    {c.hasAudio && (
                        <Button variant="outline" size="sm" disabled={loadingAudioIds.has(c.id)} onClick={() => onListen(c.id)}>
                            {loadingAudioIds.has(c.id) ? <Spinner className="size-3.5" /> : <Play />}
                            Ouvir
                        </Button>
                    )}
                    <Button size="sm" onClick={() => onView(c)}>
                        <FileText /> Ver respostas
                    </Button>
                </RowActions>
            ),
        },
    ];

    const filters: { value: Filter; label: string; count: number }[] = [
        { value: 'ALL', label: 'Todas', count: totalAll },
        { value: 'AUDIO', label: 'Com gravação', count: withAudio },
        { value: 'NO_AUDIO', label: 'Sem gravação', count: totalAll - withAudio },
    ];

    return (
        <div className="flex flex-col gap-5">
            {/* Indicadores */}
            <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <article className="pa-card dark introduction-card !p-5">
                    <Contour seed={3} rings={9} cx={0.9} cy={0.2} size={0.8} />
                    <p className="flex items-center gap-2 text-xs font-medium text-[var(--muted-dark)]"><Inbox className="size-3.5" /> Coletas recebidas</p>
                    <p className="pa-stat mt-3 text-[var(--fg-dark)]"><CountUp value={totalAll} /></p>
                </article>
                <article className="pa-card mint introduction-card !p-5" style={{ animationDelay: '100ms' }}>
                    <p className="flex items-center gap-2 text-xs font-medium text-[var(--green-deep)]"><Headphones className="size-3.5" /> Com gravação</p>
                    <p className="pa-stat mt-3"><CountUp value={withAudio} /></p>
                </article>
                <article className="pa-card introduction-card !p-5" style={{ animationDelay: '200ms' }}>
                    <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Users className="size-3.5" /> Pesquisadores ativos</p>
                    <p className="pa-stat mt-3"><CountUp value={researchersCount} /></p>
                </article>
                <article className="pa-card introduction-card !p-5" style={{ animationDelay: '300ms' }}>
                    <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Clock className="size-3.5" /> Última coleta</p>
                    <p className="pa-stat mt-3">{lastText}</p>
                </article>
            </section>

            {/* Tabela de coletas */}
            <div>
                <DataTableHeader
                    title="Coletas recebidas"
                    count={list.total}
                />

                {(totalAll > 0 || isFiltered) && (
                    <DataTableToolbar>
                        <TableSearch
                            value={search}
                            onChange={setSearch}
                            placeholder="Buscar pesquisador ou nº da coleta..."
                            label="Buscar coletas"
                        />
                        <div className="grow flex flex-wrap items-center gap-2">
                            <TableFilters<Filter> label="Gravação" value={filter} onChange={setFilter} options={filters} />
                            <TableChip tone={recordInterview ? 'soon' : 'done'}>
                                Gravação {recordInterview ? 'ligada' : 'desligada'}
                            </TableChip>
                            <TableViewControls sort={sort} onSortChange={setSort} view={view} onViewChange={setView} onRefresh={list.reload} refreshing={list.fetching} />
                        </div>
                    </DataTableToolbar>
                )}

                <DataTable
                    label="Coletas recebidas"
                    columns={columns}
                    rows={rows}
                    getRowKey={(c) => c.id}
                    minWidth="860px"
                    view={view}
                    server={list.server}
                    empty={
                        !isFiltered ? (
                            <TableEmpty
                                icon={<Inbox />}
                                title="Nenhuma coleta recebida ainda"
                                text="Assim que os pesquisadores enviarem coletas pelo aplicativo, elas aparecem aqui."
                            />
                        ) : (
                            <TableEmpty
                                title="Nenhuma coleta encontrada"
                                text="Tente outro nome ou número."
                                onClear={() => { setSearch(''); setFilter('ALL'); }}
                            />
                        )
                    }
                />
            </div>

            <RespostasColeta collection={viewing} onClose={onCloseView} />

            {player && (
                <div className="pa-card dark introduction-card !p-5">
                    <Contour seed={9} rings={8} cx={0.92} cy={0.5} size={0.8} />
                    <div className="flex items-center gap-3">
                        <div className="pa-ic"><Headphones /></div>
                        <div>
                            <h3 className="!text-base">Áudio da coleta #{player.collectionId}</h3>
                            <p className="desc">
                                Arquivo de {formatSize(player.sizeBytes)} ·{' '}
                                <a href={player.url} download={`coleta-${player.collectionId}.m4a`} className="underline">
                                    Baixar áudio
                                </a>
                            </p>
                        </div>
                    </div>
                    <audio
                        key={player.url}
                        controls
                        autoPlay
                        preload="auto"
                        src={player.url}
                        className="mt-4 w-full"
                        onError={(event) => {
                            const code = event.currentTarget.error?.code;
                            onPlayerError((code && AUDIO_ERRORS[code]) || 'Não foi possível reproduzir o áudio.');
                        }}
                    />
                    {player.error && <p className="mt-2 text-sm text-[#f0b09c]">{player.error}</p>}
                </div>
            )}
        </div>
    );
}

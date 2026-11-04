'use client';

import { UserAvatar } from "@/components/ui/user-avatar";
import { CountUp } from "@/components/ui/count-up";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LoadingState } from "@/components/ui/loadingState";
import { PaginatedList, Pagination, usePagination } from "@/components/ui/pagination";
import { RemoteComboBox } from "@/components/ui/remoteCombobox";
import { getResearchLinkedPage } from "@/lib/research";
import { Spinner } from "@/components/ui/spinner";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import {
    closeResearch,
    downloadResearchExport,
    type ExportKind,
    formatSeconds,
    getResearchPanel,
    getResearchReport,
    type QuestionChart,
    type ReportFilters,
    type ResearchPanel,
    type ResearchReport,
} from "@/lib/report";
import { BarChart3, ChevronDown, Clock, Download, FileJson, FileSpreadsheet, FileText, Table2, Gauge, Lock, PieChart as PieIcon, RefreshCw, TriangleAlert, Users, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// "Quase em tempo real": o painel se atualiza sozinho a cada 30 s enquanto a aba está aberta e visível.
const REFRESH_MS = 30_000;

const COLORS = ["#447762", "#e0917a", "#6b8fb5", "#c9a94b", "#8d6bb5", "#5aa5a5", "#b5666b", "#7a8a52"];

/** Formata data e hora (dd/mm/aaaa hh:mm); devolve o texto de reserva se a data for inválida. */
const fmtDateTime = (iso?: string | null) => {
    const t = iso ? new Date(iso) : null;
    return t && !Number.isNaN(t.getTime())
        ? t.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'Nunca sincronizou';
};

/** Formata a hora com segundos. */
const fmtTime = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

interface PainelResultadosProps {
    researchId: number;
    status: "DRAFT" | "PUBLISHED" | "IN_FIELD" | "CLOSED";
    /** Chamado depois de encerrar: a página recarrega o estado da pesquisa. */
    onClosed?: () => void;
}

/**
 * Aba de resultados: totais, gráficos por questão e desempenho por pesquisador, com filtro de
 * período.
 */
export default function PainelResultados({ researchId, status, onClosed }: PainelResultadosProps) {
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [researcherId, setResearcherId] = useState<number | undefined>(undefined);

    const [panel, setPanel] = useState<ResearchPanel | null>(null);
    const [report, setReport] = useState<ResearchReport | null>(null);
    // Lista de pesquisadores para o filtro: vem do painel SEM filtro, para o seletor não encolher ao filtrar.
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
    const [exporting, setExporting] = useState<ExportKind | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [closing, setClosing] = useState(false);

    const closed = (panel?.status ?? status) === 'CLOSED';
    const invalidRange = !!from && !!to && to < from;

    const filters = useMemo<ReportFilters>(
        () => ({ from: from || undefined, to: to || undefined, researcherId }),
        [from, to, researcherId],
    );

    const load = useCallback(async () => {
        if (invalidRange) return;
        try {
            const [p, r] = await Promise.all([getResearchPanel(researchId, filters), getResearchReport(researchId, filters)]);
            setPanel(p);
            setReport(r);
            setUpdatedAt(new Date());
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro ao carregar o painel');
        } finally {
            setLoading(false);
        }
    }, [researchId, filters, invalidRange]);

    // Carrega na abertura e a cada mudança de filtro (a tela anterior continua visível até a nova chegar).
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- busca de dados: o estado é atualizado quando a resposta chega
        load();
    }, [load]);

    // Atualização automática. Pesquisa encerrada está congelada: não há o que atualizar.
    useEffect(() => {
        if (closed) return;
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') load();
        }, REFRESH_MS);
        return () => clearInterval(timer);
    }, [closed, load]);

    // Botão "Atualizar": gira e fica desativado até a resposta chegar (mínimo de meio segundo, para dar para ver).
    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            await Promise.all([load(), new Promise((resolve) => setTimeout(resolve, 500))]);
        } finally {
            setRefreshing(false);
        }
    };

    const handleExport = async (kind: ExportKind) => {
        setExporting(kind);
        try {
            await downloadResearchExport(researchId, kind, filters);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Erro ao exportar');
        } finally {
            setExporting(null);
        }
    };

    const handleClose = async () => {
        const ok = await confirmDialog({
            title: 'Encerrar a pesquisa',
            description: 'Depois de encerrada, a pesquisa não recebe mais nenhuma coleta (nem as que ainda estão nos aparelhos) e o resultado fica congelado. Isso não pode ser desfeito.',
            confirmLabel: 'Encerrar pesquisa',
            variant: 'destructive',
        });
        if (!ok) return;
        setClosing(true);
        try {
            await closeResearch(researchId);
            toast.success('Pesquisa encerrada. O resultado está congelado.');
            await load();
            onClosed?.();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Erro ao encerrar a pesquisa');
        } finally {
            setClosing(false);
        }
    };

    if (loading && !panel) return <LoadingState label="Carregando o painel..." shape="results-panel" />;

    if (error && !panel) {
        return (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
                <p className="font-medium">Não foi possível carregar o painel</p>
                <p>{error}</p>
            </div>
        );
    }
    if (!panel || !report) return null;

    const filtered = !!(from || to || researcherId !== undefined);

    return (
        <div className="flex flex-col gap-5">
            {/* Filtros e ações */}
            <article className="pa-card flex flex-col gap-5">
                <div className="grid grow grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                        De
                        <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-xl border border-border bg-white px-3 text-sm text-foreground" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                        Até
                        <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-xl border border-border bg-white px-3 text-sm text-foreground" />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground [&_[data-slot=input-group]]:h-10 [&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:bg-white">
                        Pesquisador
                        {/* Pesquisa e paginação no servidor: só uma página de pesquisadores por vez. */}
                        <RemoteComboBox
                            fetchOptions={async (params) => {
                                const page = await getResearchLinkedPage(researchId, params);
                                return {
                                    ...page,
                                    items: page.items.map((link) => ({
                                        value: String(link.userId),
                                        label: link.name ?? `Pesquisador ${link.userId}`,
                                        hint: link.username ? `@${link.username}` : undefined,
                                    })),
                                };
                            }}
                            value={researcherId === undefined ? '' : String(researcherId)}
                            onValueChange={(value) => setResearcherId(value === '' ? undefined : Number(value))}
                            reloadKey={researchId}
                            placeholder="Todos"
                            emptyMessage="Nenhum pesquisador encontrado!"
                            clearable
                        />
                    </label>
                </div>

                {/* Ações: à esquerda atualizar e exportar; à direita a ação destrutiva, separada dos filtros */}
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                    <Button variant="outline" size="sm" className="h-10" onClick={handleRefresh} disabled={refreshing} title="Atualizar agora">
                        <RefreshCw className={refreshing ? 'animate-spin' : undefined} />Atualizar
                    </Button>

                    <DropdownMenu>
                        <DropdownMenuTrigger
                            disabled={exporting !== null}
                            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-border bg-white px-4 text-sm font-medium text-[#0f1713] transition hover:bg-[#e8f0ea] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60"
                        >
                            {exporting !== null ? <Spinner /> : <Download className="size-4" />}
                            Exportar
                            <ChevronDown className="size-4 opacity-60" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" sideOffset={8} className="w-56 rounded-2xl p-1.5">
                            {([
                                { kind: 'csv', label: 'CSV', hint: 'Planilha simples', Icon: Table2 },
                                { kind: 'xlsx', label: 'Excel', hint: 'Arquivo .xlsx', Icon: FileSpreadsheet },
                                { kind: 'json', label: 'JSON', hint: 'Dados estruturados', Icon: FileJson },
                                { kind: 'pdf', label: 'Relatório PDF', hint: 'Resumo para leitura', Icon: FileText },
                            ] as { kind: ExportKind; label: string; hint: string; Icon: typeof Table2 }[]).map(({ kind, label, hint, Icon }) => (
                                <DropdownMenuItem
                                    key={kind}
                                    onClick={() => handleExport(kind)}
                                    className="cursor-pointer gap-3 rounded-xl px-3 py-2.5 text-sm !text-[#0f1713] hover:!bg-[#e8f0ea] focus:!bg-[#e8f0ea]"
                                >
                                    <Icon className="size-4" style={{ color: '#0f1713' }} />
                                    <span className="flex grow flex-col leading-tight">
                                        <span className="font-medium !text-[#0f1713]">{label}</span>
                                        <span className="text-[11px] !text-[#5b6b62]">{hint}</span>
                                    </span>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {filtered && (
                        <Button variant="ghost" size="sm" className="h-10" onClick={() => { setFrom(''); setTo(''); setResearcherId(undefined); }}>Limpar filtros</Button>
                    )}

                    {!closed && status !== 'DRAFT' && (
                        <Button variant="destructive" size="sm" className="ml-auto h-10" onClick={handleClose} disabled={closing}>
                            {closing ? <Spinner /> : <Lock />}Encerrar
                        </Button>
                    )}
                </div>
            </article>

            {invalidRange && (
                <p role="alert" className="flex items-center gap-2 text-sm text-destructive"><TriangleAlert className="size-4" />O fim do período não pode ser anterior ao início.</p>
            )}

            {closed ? (
                <div role="status" className="flex items-center gap-3 rounded-[22px] border border-[#ecd0c5] bg-[#f3e0d9]/60 p-4 text-sm text-[#5d2d1f]">
                    <Lock className="size-5 shrink-0 text-[#8a432f]" />
                    <p>
                        Pesquisa encerrada{panel.closedAt ? ` em ${fmtDateTime(panel.closedAt)}` : ''}: não recebe mais coletas e o resultado está congelado.
                    </p>
                </div>
            ) : (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Wifi className="size-3.5" />
                    Atualiza sozinho a cada 30 segundos{updatedAt ? ` · última atualização às ${fmtTime(updatedAt)}` : ''}
                    {filtered && ' · com filtros aplicados'}
                </p>
            )}

            {/* Números principais */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Stat icon={<Users />} label="Coletas recebidas" value={<CountUp value={panel.totalCollections} />} />
                <Stat
                    icon={<Gauge />}
                    label="Meta atingida"
                    value={panel.goalPercent === null ? 'Sem meta' : <><CountUp value={panel.goalPercent} />%</>}
                    hint={panel.targetTotal ? `meta total de ${panel.targetTotal} coletas` : 'defina a meta na aba Pesquisadores'}
                    progress={panel.goalPercent}
                />
                <Stat icon={<Clock />} label="Tempo médio de coleta" value={panel.averageSeconds === null ? formatSeconds(null) : <CountUp value={panel.averageSeconds} format={formatSeconds} />} hint="do início ao fim da entrevista" />
                <Stat icon={<RefreshCw />} label="Última sincronização" value={panel.lastSyncAt ? fmtDateTime(panel.lastSyncAt) : 'Nenhuma'} small />
            </div>

            {/* Por pesquisador */}
            <article className="pa-card">
                <header className="pa-card-h">
                    <div className="pa-ic"><Users /></div>
                    <div className="grow">
                        <h3>Por pesquisador</h3>
                        <p className="desc">Coletas, meta, última sincronização e tempo médio de cada um</p>
                    </div>
                </header>

                <ResearcherTable researchers={panel.researchers} />
            </article>

            {/* Gráfico por questão */}
            <div className="flex flex-col gap-4">
                <h3 className="flex items-center gap-2 text-base font-semibold"><BarChart3 className="size-4" />Resultado por questão</h3>
                {report.questions.length === 0 ? (
                    <p className="rounded-2xl bg-muted/50 p-6 text-center text-sm text-muted-foreground">Esta pesquisa não tem questões de escolha ou sim/não para exibir em gráfico.</p>
                ) : (
                    <PaginatedList
                        items={report.questions}
                        getKey={(q) => q.questionId}
                        as="div"
                        pageSize={10}
                        pageSizeOptions={[10, 20, 50]}
                        label="Resultado por questão"
                        className="grid grid-cols-1 gap-4 xl:grid-cols-2"
                    >
                        {(q) => <QuestionCard key={q.questionId} question={q} />}
                    </PaginatedList>
                )}
            </div>
        </div>
    );
}

/** Tabela de desempenho por pesquisador, paginada. */
function ResearcherTable({ researchers }: { researchers: ResearchPanel["researchers"] }) {
    const pager = usePagination(researchers, { resetKey: researchers.length > 0 ? researchers[0].userId : null });

    return (
        <div className="mt-5">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                            <th className="pb-2 font-medium">Pesquisador</th>
                            <th className="pb-2 font-medium">Coletas</th>
                            <th className="pb-2 font-medium">Meta</th>
                            <th className="pb-2 font-medium">Última sincronização</th>
                            <th className="pb-2 font-medium">Tempo médio</th>
                        </tr>
                    </thead>
                    <tbody>
                        {researchers.length === 0 && (
                            <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Nenhum pesquisador vinculado.</td></tr>
                        )}
                        {pager.items.map((r) => (
                            <tr key={r.userId} className="border-t border-border">
                                <td className="py-3 font-medium">
                                    <UserAvatar
                                        inline
                                        ariaHidden
                                        name={r.name}
                                        src={r.avatarUrl}
                                        size={28}
                                        className="mr-2 inline-grid size-7 place-items-center rounded-full bg-[var(--mint)] align-middle text-[11px] font-semibold text-[var(--forest)]"
                                    />
                                    {r.name}
                                    {!r.linked && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">desvinculado</span>}
                                </td>
                                <td className="py-3 tabular-nums"><CountUp value={r.collected} />{r.targetCount ? ` / ${r.targetCount}` : ''}</td>
                                <td className="py-3">
                                    {r.progress === null ? <span className="text-muted-foreground">Sem meta</span> : (
                                        <div className="flex items-center gap-2">
                                            <div className="h-2 w-24 rounded-full bg-muted"><div className="h-full rounded-full bg-[var(--green-deep)]" style={{ width: `${r.progress}%` }} /></div>
                                            <span className="tabular-nums"><CountUp value={r.progress} />%</span>
                                        </div>
                                    )}
                                </td>
                                <td className="py-3">{fmtDateTime(r.lastSyncAt)}</td>
                                <td className="py-3 tabular-nums">
                                    {formatSeconds(r.averageSeconds)}
                                    {r.suspiciouslyFast && (
                                        <span title="Média bem abaixo da dos colegas: vale conferir essas coletas" className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#f3e0d9] px-2 py-0.5 text-[11px] font-semibold text-[#8a432f]">
                                            <TriangleAlert className="size-3" />rápido demais
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {pager.visible && <Pagination {...pager.pagerProps} label="Pesquisadores da pesquisa" />}
        </div>
    );
}

/** Card de um número do painel (ícone, valor, dica e barra de progresso). */
function Stat({ icon, label, value, hint, progress, small }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string; progress?: number | null; small?: boolean }) {
    return (
        <article className="pa-card">
            <header className="pa-card-h">
                <div className="pa-ic">{icon}</div>
                <div className="grow"><p className="desc">{label}</p></div>
            </header>
            <p className={`mt-4 font-semibold tracking-tight tabular-nums ${small ? 'text-lg' : 'text-3xl'}`}>{value}</p>
            {progress !== undefined && progress !== null && (
                <div className="mt-3 h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-[var(--green-deep)] transition-all" style={{ width: `${progress}%` }} /></div>
            )}
            {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
        </article>
    );
}

/** Gráfico de uma questão, em barras ou pizza. */
function QuestionCard({ question }: { question: QuestionChart }) {
    // Barras por padrão (contagem); pizza mostra a proporção.
    const [mode, setMode] = useState<'bar' | 'pie'>('bar');
    const hasData = question.data.some((d) => d.count > 0);
    const multiple = question.type === 'MULTIPLE_CHOICE';

    return (
        <article className="pa-card">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h4 className="break-words text-[15px] font-semibold leading-snug">{question.statement}</h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {question.answered} de {question.totalCollections} {question.totalCollections === 1 ? 'coleta respondeu' : 'coletas responderam'}
                        {multiple && ' · pode marcar mais de uma'}
                    </p>
                </div>
                <div className="flex shrink-0 rounded-full border border-border p-0.5" role="group" aria-label="Tipo de gráfico">
                    <button type="button" onClick={() => setMode('bar')} aria-pressed={mode === 'bar'} title="Barras" className={`grid size-8 place-items-center rounded-full ${mode === 'bar' ? 'bg-ink text-white' : 'text-muted-foreground'}`}><BarChart3 className="size-4" /></button>
                    <button type="button" onClick={() => setMode('pie')} aria-pressed={mode === 'pie'} title="Pizza (proporção)" className={`grid size-8 place-items-center rounded-full ${mode === 'pie' ? 'bg-ink text-white' : 'text-muted-foreground'}`}><PieIcon className="size-4" /></button>
                </div>
            </div>

            {!hasData ? (
                <p className="mt-6 py-8 text-center text-sm text-muted-foreground">Nenhuma resposta ainda.</p>
            ) : mode === 'bar' ? (
                <div className="mt-4" style={{ height: Math.max(160, question.data.length * 44) }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={question.data} layout="vertical" margin={{ left: 0, right: 24 }}>
                            <XAxis type="number" allowDecimals={false} hide />
                            <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                            <Tooltip formatter={(value, _n, item) => [`${value} (${(item.payload as { percent: number }).percent}%)`, 'Respostas']} />
                            <Bar dataKey="count" radius={4} label={{ position: 'right', fontSize: 12 }}>
                                {question.data.map((d, i) => <Cell key={d.key} fill={COLORS[i % COLORS.length]} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            ) : (
                <div className="mt-4 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie data={question.data.filter((d) => d.count > 0)} dataKey="count" nameKey="label" innerRadius={45} outerRadius={80} paddingAngle={2}>
                                {question.data.filter((d) => d.count > 0).map((d) => <Cell key={d.key} fill={COLORS[question.data.indexOf(d) % COLORS.length]} />)}
                            </Pie>
                            <Tooltip formatter={(value, name, item) => [`${value} (${(item.payload as { percent: number }).percent}%)`, name]} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            )}

            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {question.data.map((d, i) => (
                    <li key={d.key} className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                        {d.label}: <strong className="text-foreground">{d.count}</strong> ({d.percent}%)
                    </li>
                ))}
            </ul>
        </article>
    );
}

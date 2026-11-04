'use client';

import { UserAvatar } from "@/components/ui/user-avatar";
import { CountUp } from "@/components/ui/count-up";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadingState } from "@/components/ui/loadingState";
import { PaginatedList, ServerPagination } from "@/components/ui/pagination";
import { usePagedResource } from "@/hooks/usePagedResource";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { getResearchCopiesPage, revokeResearchCopy, unblockResearchDevice, type ResearchCopiesOverview, type ResearchCopy, type ResearchCopyHistoryItem } from "@/lib/research";
import type { Page } from "@/lib/pagination";
import { CircleHelp, Lock, LockOpen, RefreshCw, Search, ShieldCheck, ShieldOff, Smartphone, TriangleAlert, Undo2, UserX } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

const MAX_REASON = 300;

/** Formata data e hora (dd/mm/aaaa hh:mm); devolve o texto de reserva se a data for inválida. */
const fmtDateTime = (iso?: string | null) => {
    const t = iso ? new Date(iso) : null;
    return t && !Number.isNaN(t.getTime())
        ? t.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '-';
};

/** Escreve o número com a palavra no singular ou no plural. */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Aparelhos têm um identificador longo (device_<hora>_<sufixo>): mostra o fim, que é o que os
 * diferencia.
 */
const shortDevice = (id: string) => (id.length > 18 ? `…${id.slice(-12)}` : id);

type HistoryFilter = 'ALL' | 'RETURNED' | 'REVOKED';
const FILTERS: { value: HistoryFilter; label: string }[] = [
    { value: 'ALL', label: 'Todas' },
    { value: 'RETURNED', label: 'Devolvidas' },
    { value: 'REVOKED', label: 'Revogadas' },
];

interface CopiasEmCampoProps {
    researchId: number;
    /** Chamado depois de uma revogação: a página recarrega o estado da trava. */
    onChanged?: () => void;
}

/** Aba de cópias em campo: aparelhos com a pesquisa baixada e o histórico, com a ação de revogar. */
export default function CopiasEmCampo({ researchId, onChanged }: CopiasEmCampoProps) {
    // Busca e filtro do histórico (feitos no servidor, que devolve uma página do histórico por vez).
    const [filter, setFilter] = useState<HistoryFilter>('ALL');
    const list = usePagedResource<ResearchCopyHistoryItem, Page<ResearchCopyHistoryItem> & { overview: ResearchCopiesOverview }>(
        async (params) => {
            const overview = await getResearchCopiesPage(researchId, { ...params, status: filter });
            return { ...overview.history, overview };
        },
        { pageSize: 10, filters: { filter, researchId } },
    );
    const query = list.search;
    const setQuery = list.setSearch;
    const data = list.data?.overview ?? null;
    const error = list.error;
    const loading = list.loading;
    const load = async () => { list.reload(); };

    // Revogação em andamento: a cópia escolhida, o motivo digitado e o envio.
    const [revoking, setRevoking] = useState<ResearchCopy | null>(null);
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Desbloqueio de aparelho em andamento.
    const [unblocking, setUnblocking] = useState<ResearchCopy | null>(null);
    const [unblockSubmitting, setUnblockSubmitting] = useState(false);

    const confirmUnblock = async () => {
        if (!unblocking) return;
        setUnblockSubmitting(true);
        try {
            await unblockResearchDevice(researchId, unblocking.id);
            toast.success('Aparelho desbloqueado. Ele já pode baixar a pesquisa de novo.');
            setUnblocking(null);
            await load();
            onChanged?.();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Erro ao desbloquear o aparelho');
        } finally {
            setUnblockSubmitting(false);
        }
    };

    const closeRevoke = () => {
        if (submitting) return;
        setRevoking(null);
        setReason('');
    };

    const confirmRevoke = async () => {
        if (!revoking) return;
        setSubmitting(true);
        try {
            await revokeResearchCopy(researchId, revoking.id, reason);
            toast.success('Cópia revogada. O contador foi liberado e o aparelho perdeu o acesso.');
            setRevoking(null);
            setReason('');
            await load();
            onChanged?.();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Erro ao revogar a cópia');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <LoadingState label="Carregando quem está com a pesquisa..." shape="copies" />;

    if (error || !data) {
        return (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
                <p className="font-medium">Não foi possível carregar as cópias em campo</p>
                <p>{error}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => list.reload()}>Tentar de novo</Button>
            </div>
        );
    }

    const active = data.active;
    const revokedList = data.revokedUsers;
    const history = list.items;

    return (
        <div className="flex flex-col gap-5">
            {/* Estado da trava e o motivo */}
            <article
                className={`pa-card ${data.locked ? '' : 'mint'}`}
                aria-live="polite"
            >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div
                        className={`grid size-14 shrink-0 place-items-center rounded-2xl ${data.locked ? 'bg-[#f3e0d9] text-[var(--clay-ink)]' : 'bg-white/70 text-[var(--green-deep)]'
                            }`}
                    >
                        {data.locked ? <Lock className="size-6" /> : <LockOpen className="size-6" />}
                    </div>

                    <div className="grow">
                        <h3 className="text-base font-semibold tracking-tight">
                            {data.lockReason === 'ACTIVE_COPIES' && `Questionário travado · ${plural(data.activeCopies, 'aparelho com a pesquisa', 'aparelhos com a pesquisa')}`}
                            {data.lockReason === 'CLOSED' && 'Questionário travado · pesquisa encerrada'}
                            {!data.locked && 'Questionário editável · nenhum aparelho com a pesquisa'}
                        </h3>
                        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                            {data.locked
                                ? data.lockMessage
                                : 'Quando um pesquisador baixa a pesquisa, o questionário trava para que não existam duas versões circulando em campo. Quando a última cópia for devolvida, ele destrava sozinho.'}
                        </p>
                        {data.locked && (
                            <p className="mt-2 text-xs text-muted-foreground">
                                Continuam liberados: vincular pesquisador, mudar meta, prorrogar o prazo, acompanhar e emitir relatório.
                            </p>
                        )}
                    </div>

                    <div className="text-right">
                        <p className="text-[34px] font-light leading-none tracking-tighter tabular-nums"><CountUp value={data.activeCopies} /></p>
                        <p className="text-[12.5px] text-muted-foreground">{data.activeCopies === 1 ? 'cópia ativa' : 'cópias ativas'}</p>
                    </div>
                </div>
            </article>

            {/* Quem está com a pesquisa e usuários revogados, lado a lado */}
            <div className={`grid items-stretch gap-5 ${revokedList.length > 0 ? 'lg:grid-cols-2' : ''}`}>
                {/* Quem está com a pesquisa */}
                <article className="pa-card">
                    <header className="pa-card-h">
                        <div className="pa-ic"><Smartphone /></div>
                        <div className="grow">
                            <h3>Quem está com a pesquisa</h3>
                            <p className="desc">Cada aparelho que baixou conta uma cópia. O mesmo pesquisador em dois celulares conta duas.</p>
                        </div>
                    </header>

                    {active.length === 0 ? (
                        <p className="mt-5 rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">
                            Ninguém está com a pesquisa baixada agora.
                        </p>
                    ) : (
                        <PaginatedList items={active} getKey={(copy) => copy.id} pageSize={5} pageSizeOptions={[5, 10, 25]} label="Cópias ativas" className="mt-5 flex flex-col gap-3">
                            {(copy) => (
                                <li key={copy.id} className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-4 sm:flex-row sm:items-center">
                                    <div className="min-w-0 grow">
                                        <p className="truncate text-[15px] font-semibold tracking-tight">
                                            <UserAvatar
                                                inline
                                                ariaHidden
                                                name={copy.researcherName ?? ''}
                                                src={copy.researcherAvatarUrl}
                                                size={28}
                                                className="mr-2 inline-grid size-7 place-items-center rounded-full bg-[var(--mint)] align-middle text-[11px] font-semibold text-[var(--forest)]"
                                            />
                                            {copy.researcherName ?? 'Pesquisador removido'}
                                            {copy.researcherUsername && (
                                                <span className="ml-2 text-sm font-normal text-muted-foreground">@{copy.researcherUsername}</span>
                                            )}
                                        </p>
                                        <p className="mt-0.5 text-[13px] text-muted-foreground">
                                            <span title={copy.deviceId} className="font-mono">Aparelho {shortDevice(copy.deviceId)}</span>
                                            {' · '}baixada em {fmtDateTime(copy.downloadedAt)}
                                        </p>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="shrink-0 text-[#8a432f]"
                                        onClick={() => { setRevoking(copy); setReason(''); }}
                                        title="Para aparelho perdido, quebrado ou pesquisador que saiu"
                                    >
                                        <ShieldOff />Revogar acesso
                                    </Button>
                                </li>
                            )}
                        </PaginatedList>
                    )}
                </article>

                {/* Usuários revogados */}
                {revokedList.length > 0 && (
                    <article className="pa-card">
                        <header className="pa-card-h">
                            <div className="pa-ic"><UserX /></div>
                            <div className="grow">
                                <h3>Usuários revogados</h3>
                                <p className="desc">
                                    {plural(revokedList.length, 'pesquisador teve', 'pesquisadores tiveram')} o acesso revogado nesta pesquisa.
                                    {' '}Desbloqueie o aparelho para ele voltar a baixar.
                                </p>
                            </div>
                        </header>

                        <PaginatedList items={revokedList} getKey={(user) => user.key} pageSize={5} pageSizeOptions={[5, 10, 25]} label="Usuários revogados" className="mt-5 flex flex-col gap-3">
                            {(user) => (
                                <li key={user.key} className="rounded-2xl bg-muted/60 p-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <UserAvatar
                                            ariaHidden
                                            name={user.name ?? ''}
                                            src={user.avatarUrl}
                                            size={32}
                                            className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--mint)] text-xs font-semibold text-[var(--forest)]"
                                        />
                                        <span className="text-[15px] font-semibold tracking-tight">{user.name ?? 'Pesquisador removido'}</span>
                                        {user.username && <span className="text-sm text-muted-foreground">@{user.username}</span>}
                                        <Badge variant={user.blocked > 0 ? 'destructive' : 'default'}>
                                            {user.blocked > 0 ? `${plural(user.blocked, 'aparelho bloqueado', 'aparelhos bloqueados')}` : 'Todos desbloqueados'}
                                        </Badge>
                                        {user.revocations > 1 && (
                                            <span className="text-xs text-muted-foreground">{user.revocations} revogações</span>
                                        )}
                                    </div>

                                    <ul className="mt-3 flex flex-col gap-2">
                                        {user.devices.map((copy) => (
                                            <li key={copy.deviceId} className="flex flex-col gap-2 border-t border-border pt-2.5 sm:flex-row sm:items-center">
                                                <div className="grow text-[13px] text-muted-foreground">
                                                    <span title={copy.deviceId} className="font-mono">Aparelho {shortDevice(copy.deviceId)}</span>
                                                    {' · '}revogado em {fmtDateTime(copy.revokedAt)}{copy.revokedByName ? ` por ${copy.revokedByName}` : ''}
                                                    {copy.revokeReason && <> · Motivo: {copy.revokeReason}</>}
                                                    {!copy.deviceBlocked && copy.unblockedAt && (
                                                        <span className="text-[var(--green-deep)]"> · desbloqueado em {fmtDateTime(copy.unblockedAt)}</span>
                                                    )}
                                                </div>
                                                {copy.deviceBlocked && (
                                                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => setUnblocking(copy)}>
                                                        <ShieldCheck />Desbloquear aparelho
                                                    </Button>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </li>
                            )}
                        </PaginatedList>
                    </article>
                )}
            </div>

            {/* Histórico: tudo registrado */}
            {data.historyTotal > 0 && (
                <article className="pa-card">
                    <header className="pa-card-h">
                        <div className="pa-ic"><Undo2 /></div>
                        <div className="grow">
                            <h3>Histórico</h3>
                            <p className="desc">Devoluções e revogações ficam registradas com data.</p>
                        </div>
                    </header>

                    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="relative grow">
                            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                type="search"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Buscar por pesquisador, usuário, aparelho ou motivo"
                                aria-label="Buscar no histórico"
                                className="pl-10"
                            />
                        </div>
                        <div role="group" aria-label="Filtrar histórico por situação" className="flex shrink-0 gap-1.5">
                            {FILTERS.map((f) => (
                                <Button
                                    key={f.value}
                                    variant={filter === f.value ? 'default' : 'outline'}
                                    size="sm"
                                    aria-pressed={filter === f.value}
                                    onClick={() => setFilter(f.value)}
                                >
                                    {f.label}
                                </Button>
                            ))}
                            <Button variant="outline" size="sm" onClick={() => list.reload()} disabled={list.fetching} title="Atualizar o histórico">
                                <RefreshCw className={list.fetching ? 'animate-spin' : undefined} />Atualizar
                            </Button>
                        </div>
                    </div>

                    {(query.trim() || filter !== 'ALL') && (
                        <p className="mt-3 text-[13px] text-muted-foreground" aria-live="polite">
                            {plural(list.total, 'registro encontrado', 'registros encontrados')} de {data.historyTotal}.
                            {list.total === 0 && (
                                <button type="button" className="ml-2 underline" onClick={() => { setQuery(''); setFilter('ALL'); }}>Limpar filtros</button>
                            )}
                        </p>
                    )}

                    <ul aria-label="Histórico de cópias" className="mt-4 flex flex-col gap-2.5">
                        {history.map((copy) => (
                            <li key={copy.id} className="flex flex-col gap-1 rounded-2xl border border-border p-3.5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <UserAvatar
                                        ariaHidden
                                        name={copy.researcherName ?? ''}
                                        src={copy.researcherAvatarUrl}
                                        size={24}
                                        className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--mint)] text-[10px] font-semibold text-[var(--forest)]"
                                    />
                                    <span className="text-sm font-semibold">{copy.researcherName ?? 'Pesquisador removido'}</span>
                                    {copy.researcherUsername && <span className="text-xs text-muted-foreground">@{copy.researcherUsername}</span>}
                                    <Badge variant={copy.status === 'REVOKED' ? 'destructive' : 'default'}>
                                        {copy.status === 'REVOKED' ? 'Revogada' : 'Devolvida'}
                                    </Badge>
                                </div>
                                <p className="text-[13px] text-muted-foreground">
                                    <span title={copy.deviceId} className="font-mono">Aparelho {shortDevice(copy.deviceId)}</span>
                                    {' · '}baixada em {fmtDateTime(copy.downloadedAt)}
                                    {copy.status === 'RETURNED' && <> · devolvida em {fmtDateTime(copy.returnedAt)}</>}
                                    {copy.status === 'REVOKED' && (
                                        <> · revogada em {fmtDateTime(copy.revokedAt)}{copy.revokedByName ? ` por ${copy.revokedByName}` : ''}</>
                                    )}
                                </p>
                                {copy.status === 'REVOKED' && copy.revokeReason && (
                                    <p className="text-[13px] text-foreground">Motivo: {copy.revokeReason}</p>
                                )}
                                {copy.status === 'REVOKED' && copy.unblockedAt && (
                                    <p className="text-[13px] text-[var(--green-deep)]">
                                        Aparelho desbloqueado em {fmtDateTime(copy.unblockedAt)}{copy.unblockedByName ? ` por ${copy.unblockedByName}` : ''}
                                    </p>
                                )}
                                {copy.unblockable && (
                                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                                        <span className="text-[13px] text-[#8a432f]">Este aparelho está bloqueado para esta pesquisa.</span>
                                        <Button variant="outline" size="sm" onClick={() => setUnblocking(copy)}>
                                            <ShieldCheck />Desbloquear aparelho
                                        </Button>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                    <ServerPagination server={list.server} label="Histórico de cópias" pageSizeOptions={[10, 25, 50]} />
                </article>
            )}

            {/* Desbloquear aparelho */}
            <Dialog open={unblocking !== null} onOpenChange={(open) => { if (!open && !unblockSubmitting) setUnblocking(null); }}>
                <DialogContent showCloseButton={false} className="sm:max-w-md">
                    <DialogHeader className="items-start gap-3">
                        <div className="flex size-11 items-center justify-center rounded-full bg-mint text-forest">
                            <CircleHelp className="size-5" />
                        </div>
                        <DialogTitle className="text-xl tracking-tight">Desbloquear este aparelho?</DialogTitle>
                        <DialogDescription className="text-sm leading-relaxed">
                            O aparelho <span className="font-mono">{unblocking ? shortDevice(unblocking.deviceId) : ''}</span> volta a poder baixar
                            esta pesquisa. Ao baixar, ele cria uma cópia nova e o questionário trava de novo. A revogação anterior
                            continua no histórico, com quem desbloqueou e quando.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setUnblocking(null)} disabled={unblockSubmitting}>Cancelar</Button>
                        <Button onClick={confirmUnblock} disabled={unblockSubmitting}>
                            {unblockSubmitting ? <span className="flex items-center gap-2"><Spinner />Desbloqueando...</span> : 'Desbloquear aparelho'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Revogação forçada */}
            <Dialog open={revoking !== null} onOpenChange={(open) => { if (!open) closeRevoke(); }}>
                <DialogContent showCloseButton={false} className="sm:max-w-md">
                    <DialogHeader className="items-start gap-3">
                        <div className="flex size-11 items-center justify-center rounded-full bg-[#f3e0d9] text-[#8a432f]">
                            <TriangleAlert className="size-5" />
                        </div>
                        <DialogTitle className="text-xl tracking-tight">Revogar o acesso deste aparelho?</DialogTitle>
                        <DialogDescription className="text-sm leading-relaxed">
                            {revoking?.researcherName ?? 'O pesquisador'} perde a cópia deste aparelho: ela deixa de contar, o contador é liberado
                            e o aparelho não baixa a pesquisa de novo nem envia novas coletas. Coletas já recebidas ficam como estão.
                            Isto fica registrado e não pode ser desfeito.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col gap-1.5">
                        <label htmlFor="revoke-reason" className="text-sm font-medium">Motivo (opcional, mas fica no histórico)</label>
                        <Textarea
                            id="revoke-reason"
                            value={reason}
                            maxLength={MAX_REASON}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Ex.: aparelho perdido em campo"
                            disabled={submitting}
                        />
                        <p className="text-right text-xs text-muted-foreground">{reason.length}/{MAX_REASON}</p>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={closeRevoke} disabled={submitting}>Cancelar</Button>
                        <Button variant="destructive" onClick={confirmRevoke} disabled={submitting}>
                            {submitting ? <span className="flex items-center gap-2"><Spinner />Revogando...</span> : 'Revogar acesso'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

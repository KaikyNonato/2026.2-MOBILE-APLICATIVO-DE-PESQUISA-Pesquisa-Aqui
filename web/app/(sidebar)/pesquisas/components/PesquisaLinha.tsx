'use client';

import { Button } from "@/components/ui/button";
import DialogLayout from "@/components/ui/dialogLayout";
import type { Research } from "@/lib/research";
import { Pencil, Send, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import ModalEditarPesquisa from "./ModalEditarPesquisa";
import { TeamStack, Trail, viewOf, type PesquisaItemProps } from "./pesquisaView";
import type { Research as EditableResearch } from "./TabelaPesquisas";

/** Tabela do modo "Lista": cabeçalho fixo e uma linha por pesquisa (<PesquisaLinha>). */
export function ListaPesquisas({ children }: { children: ReactNode }) {
    return (
        <div className="pq-list" role="table" aria-label="Pesquisas">
            <div className="pq-list-in">
                <div className="pq-list-tab">
                    <div className="pq-lh" role="row">
                        <span role="columnheader">Pesquisa</span>
                        <span role="columnheader">Período</span>
                        <span role="columnheader">Equipe</span>
                        <span role="columnheader">Coletas</span>
                        <span role="columnheader">Situação</span>
                        <span role="columnheader" className="sr-only">Ações</span>
                    </div>
                    {children}
                </div>
            </div>
        </div>
    );
}

/** Linha de uma pesquisa na lista. Rascunhos também ganham editar e publicar; excluir aparece enquanto nenhum pesquisador baixou a pesquisa (só ícones, antes do "Abrir"). */
export default function PesquisaLinha({ research, team, collections, teamLoading = false, now, onPublish, onUnpublish, onDelete, onUpdated }: PesquisaItemProps) {
    const view = viewOf(research, now, teamLoading ? null : collections);
    const isDraft = research.status === "DRAFT";
    const href = `/pesquisas/${research.id}`;

    return (
        <div className="pq-lr" role="row">
            <div className="tt" role="cell">
                <b><Link href={href}>{research.title}</Link></b>
                <span>{research.targetAudience || research.objective || ""}</span>
            </div>

            <div role="cell">
                <Trail kind={view.kind} soon={view.soon} done={view.done} />
                <div className="pq-dates"><span>{view.startLabel}</span><span>{view.endLabel}</span></div>
            </div>

            <div role="cell"><TeamStack team={team} loading={teamLoading} /></div>

            <div className="cn" role="cell">{teamLoading ? "–" : collections}</div>

            <div role="cell"><span className={`pq-chip ${view.chipClass}`}><i />{view.chipLabel}</span></div>

            <div className="ra" role="cell">
                {isDraft && (
                    <>
                        <span className="pq-ico" title="Editar">
                            <DialogLayout
                                triggerButtonVariant="outline"
                                triggerButtonSize="sm"
                                dialogTrigger={<><Pencil aria-hidden="true" /><span className="sr-only">Editar {research.title}</span></>}
                                dialogTitle={`Editar: ${research.title}`}
                                dialogDescription="Atualize as informações da pesquisa abaixo."
                                dialogContentClassName="min-h-200"
                                dialogContent={
                                    <ModalEditarPesquisa
                                        research={research as unknown as EditableResearch}
                                        onSuccess={(updated) => onUpdated(updated as unknown as Research)}
                                    />
                                }
                            />
                        </span>
                        <Button size="sm" variant="outline" className="pq-ico" title="Publicar" aria-label={`Publicar ${research.title}`} onClick={() => onPublish(research.id)}>
                            <Send />
                        </Button>
                    </>
                )}
                {research.status === "PUBLISHED" && research.canDelete && (
                    <Button size="sm" variant="outline" className="pq-ico" title="Voltar para rascunho" aria-label={`Voltar ${research.title} para rascunho`} onClick={() => onUnpublish(research.id)}>
                        <Undo2 />
                    </Button>
                )}
                {research.canDelete && (
                    <Button size="sm" variant="destructive" className="pq-ico" title="Excluir" aria-label={`Excluir ${research.title}`} onClick={() => onDelete(research.id)}>
                        <Trash2 />
                    </Button>
                )}
                <Link href={href} className="pq-btn dark">Abrir</Link>
            </div>
        </div>
    );
}

'use client';

import { Button } from "@/components/ui/button";
import { Contour } from "@/components/ui/contour";
import DialogLayout from "@/components/ui/dialogLayout";
import type { Research } from "@/lib/research";
import { Send, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import ModalEditarPesquisa from "./ModalEditarPesquisa";
import { TeamStack, Trail, viewOf, type PesquisaItemProps } from "./pesquisaView";
import type { Research as EditableResearch } from "./TabelaPesquisas";

/** Um cartão por pesquisa: faixa colorida com a situação, trilha do período, coletas, equipe e as ações do dia a dia. */
export default function PesquisaCard({ research, team, collections, teamLoading = false, now, onPublish, onUnpublish, onDelete, onUpdated }: PesquisaItemProps) {
    const view = viewOf(research, now, teamLoading ? null : collections);
    const isDraft = research.status === "DRAFT";
    const href = `/pesquisas/${research.id}`;

    return (
        <article className="pq-card">
            <div className={`pq-strip ${view.kind}`}>
                <Contour seed={research.id * 1.7} rings={7} cx={0.86} cy={0.1} size={1.15} width={400} height={84} />
                <span className={`pq-chip ${view.chipClass}`}><i />{view.chipLabel}</span>
                {research.recordInterview && <span className="pq-tag" title="Esta pesquisa grava a entrevista em áudio">Áudio</span>}
            </div>

            <div className="pq-body">
                <h3><Link href={href}>{research.title}</Link></h3>
                <p className="pq-obj">{research.objective || research.description || "Sem descrição."}</p>
                <div>
                    <Trail kind={view.kind} soon={view.soon} done={view.done} />
                    <div className="pq-dates"><span>{view.startLabel}</span><span>{view.endLabel}</span></div>
                </div>
                <p className={`pq-note${view.soon ? " soon" : ""}`}>{view.note}</p>
            </div>

            <div className="pq-foot">
                <div className="pq-count">
                    <b>{teamLoading ? "–" : collections}</b>
                    <span>{collections === 1 && !teamLoading ? "coleta" : "coletas"}</span>
                </div>
                <TeamStack team={team} loading={teamLoading} />
            </div>

            <div className="pq-acts">
                <Link href={href} className="pq-btn dark">Abrir</Link>
                {isDraft ? (
                    <>
                        <DialogLayout
                            triggerButtonVariant="outline"
                            triggerButtonSize="sm"
                            dialogTrigger="Editar"
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
                        <Button size="sm" variant="outline" onClick={() => onPublish(research.id)}><Send />Publicar</Button>
                    </>
                ) : (
                    <span title="Pesquisa publicada: não pode mais ser editada">
                        <Button size="sm" variant="outline" disabled>Editar</Button>
                    </span>
                )}
                {research.status === "PUBLISHED" && research.canDelete && (
                    <Button size="sm" variant="outline" onClick={() => onUnpublish(research.id)}><Undo2 />Voltar para rascunho</Button>
                )}
                {research.canDelete && (
                    <Button size="sm" variant="destructive" onClick={() => onDelete(research.id)} aria-label={`Excluir ${research.title}`}><Trash2 />Excluir</Button>
                )}
            </div>
        </article>
    );
}

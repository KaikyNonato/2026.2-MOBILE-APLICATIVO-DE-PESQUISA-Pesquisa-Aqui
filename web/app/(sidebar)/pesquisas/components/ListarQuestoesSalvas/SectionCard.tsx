import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FormSection } from "@/lib/questionnaire";
import { QuestionCard, QuestionActions, OptionActions } from "./QuestionCard";
import { RegrasExibicao, type RulesContext } from "./RegrasExibicao";
import { useReadOnly } from "./ReadOnlyContext";

interface SectionCardProps {
    section: FormSection;
    sIndex: number;
    totalSections: number;
    onBlurTitle: (sectionId: string, title: string) => void;
    onMove: (index: number, direction: "up" | "down") => void;
    onDelete: (sectionId: string) => void;
    onAddQuestion: (sectionId: string) => void;
    qActions: QuestionActions;
    optActions: OptionActions;
    rulesCtx: RulesContext;
    openQuestionIds: Set<string>;
    onToggleQuestion: (questionId: string) => void;
}

function RoundButton({
    label, onClick, disabled, danger, children,
}: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "grid size-9 place-items-center rounded-full border border-border bg-white text-muted-foreground transition-all disabled:cursor-not-allowed disabled:opacity-35 [&>svg]:size-4",
                danger
                    ? "hover:border-[#e8c4b8] hover:bg-[#f3e0d9] hover:text-[#8a432f]"
                    : "hover:border-[#c6d0c9] hover:bg-[#e4ece7] hover:text-ink"
            )}
        >
            {children}
        </button>
    );
}

export function SectionCard({
    section, sIndex, totalSections, onBlurTitle, onMove, onDelete, onAddQuestion,
    qActions, optActions, rulesCtx, openQuestionIds, onToggleQuestion,
}: SectionCardProps) {
    const readOnly = useReadOnly();
    const [collapsed, setCollapsed] = useState(false);
    const total = section.questions.length;
    const required = section.questions.filter((q) => q.required).length;

    return (
        <section className="pa-enter overflow-hidden rounded-[26px] border border-border bg-white shadow-[0_24px_40px_-34px_rgba(10,20,16,0.3)]">
            <header className="relative flex flex-wrap items-center gap-3 rounded-t-[25px] border-b border-l-4 border-border border-l-[var(--green)] bg-gradient-to-r from-[#eef5f0] to-white px-4 py-4 sm:flex-nowrap sm:px-5">

                <span className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--mint)] text-lg font-bold text-[var(--green-deep)]">
                    {section.order}
                </span>

                <div className="relative order-last min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-0">
                    <p className="mb-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--green)]">
                        Seção {section.order}
                    </p>
                    <Input
                        defaultValue={section.title}
                        readOnly={readOnly}
                        onBlur={(e) => { if (!readOnly) onBlurTitle(section.id, e.target.value); }}
                        placeholder="Título da seção"
                        className="h-9 rounded-xl border-transparent bg-transparent px-2 -ml-2 text-lg font-semibold tracking-tight text-ink shadow-none placeholder:text-muted-foreground hover:border-border focus-visible:border-[var(--green)] focus-visible:bg-white focus-visible:ring-[rgba(68,119,98,0.2)]"
                    />
                </div>

                <div className="relative hidden shrink-0 items-center gap-1.5 md:flex">
                    <span className="inline-flex h-7 items-center rounded-full bg-[#e4ece7] px-3 text-xs font-medium text-[var(--green-deep)]">
                        {total} {total === 1 ? "questão" : "questões"}
                    </span>
                    {required > 0 && (
                        <span className="inline-flex h-7 items-center rounded-full bg-[#f3e0d9] px-3 text-xs font-medium text-[#8a432f]">
                            {required} {required === 1 ? "obrigatória" : "obrigatórias"}
                        </span>
                    )}
                </div>

                <div className="relative ml-auto flex shrink-0 items-center gap-1.5 sm:ml-0">
                    {!readOnly && (
                        <>
                            <RoundButton label="Mover seção para cima" onClick={() => onMove(sIndex, "up")} disabled={sIndex === 0}><ArrowUp /></RoundButton>
                            <RoundButton label="Mover seção para baixo" onClick={() => onMove(sIndex, "down")} disabled={sIndex === totalSections - 1}><ArrowDown /></RoundButton>
                            <RoundButton danger label="Excluir seção" onClick={() => onDelete(section.id)}><Trash2 /></RoundButton>
                        </>
                    )}
                    <RoundButton label={collapsed ? "Expandir seção" : "Recolher seção"} onClick={() => setCollapsed((c) => !c)}>
                        <ChevronDown className={cn("transition-transform", collapsed && "-rotate-90")} />
                    </RoundButton>
                </div>
            </header>

            {!collapsed && (
                <div className="p-3 sm:p-4">
                    {/* Pulo de seção: esconde (ou só mostra) a seção inteira conforme respostas anteriores */}
                    {sIndex > 0 && total > 0 && <div className="mb-3"><RegrasExibicao section={section} ctx={rulesCtx} /></div>}
                    {total === 0 ? (
                        <p className="rounded-2xl border border-dashed border-input bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
                            Esta seção ainda não tem questões.
                        </p>
                    ) : (
                        <div className="relative space-y-1 before:absolute before:bottom-8 before:left-[22px] before:top-8 before:w-px before:border-l before:border-dashed before:border-[#c6d0c9]">
                            {section.questions.map((q, qIndex) => (
                                <QuestionCard
                                    key={q.id}
                                    sectionId={section.id}
                                    q={q}
                                    qIndex={qIndex}
                                    totalQuestions={total}
                                    qActions={qActions}
                                    optActions={optActions}
                                    rulesCtx={rulesCtx}
                                    open={openQuestionIds.has(q.id)}
                                    onToggle={() => onToggleQuestion(q.id)}
                                />
                            ))}
                        </div>
                    )}

                    {!readOnly && (
                    <button
                        type="button"
                        onClick={() => onAddQuestion(section.id)}
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#b9c9bf] bg-[#f4f8f5] px-4 py-3.5 text-sm font-semibold text-[var(--green-deep)] transition-all hover:border-[var(--green)] hover:bg-[#e4ece7] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                    >
                        <span className="grid size-6 place-items-center rounded-full bg-[var(--green-deep)] text-white"><Plus className="size-3.5" /></span>
                        Adicionar questão nesta seção
                    </button>
                    )}
                </div>
            )}
        </section>
    );
}

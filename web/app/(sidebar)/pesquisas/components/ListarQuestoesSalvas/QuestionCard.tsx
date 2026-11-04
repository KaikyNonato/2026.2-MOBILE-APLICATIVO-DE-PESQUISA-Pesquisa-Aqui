import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    ArrowDown, ArrowUp, CalendarDays, Camera, ChevronDown, CircleDot, Clock, GitBranch, Hash,
    Images, ListChecks, MapPin, Mic, Plus, Star, ToggleLeft, Trash2, Type, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FormQuestion, FrontendQuestionType } from "@/lib/questionnaire";
import { RegrasExibicao, type RulesContext } from "./RegrasExibicao";
import { useReadOnly } from "./ReadOnlyContext";

export const QUESTION_TYPES_LABEL: { type: FrontendQuestionType; label: string }[] = [
    { type: "text", label: "Texto Livre" }, { type: "number", label: "Numérica" },
    { type: "date", label: "Data" }, { type: "time", label: "Hora" },
    { type: "boolean", label: "Sim / Não" }, { type: "single-choice", label: "Escolha Única" },
    { type: "multiple-choice", label: "Múltipla Escolha" }, { type: "rating-1-5", label: "Escala de 1 a 5" },
    { type: "photo", label: "Foto" }, { type: "multiple-photos", label: "Várias Fotos" },
    { type: "location", label: "Localização" }, { type: "audio", label: "Áudio" },
];

const QUESTION_TYPE_ICONS: Record<FrontendQuestionType, LucideIcon> = {
    "text": Type, "number": Hash, "date": CalendarDays, "time": Clock,
    "boolean": ToggleLeft, "single-choice": CircleDot, "multiple-choice": ListChecks, "rating-1-5": Star,
    "photo": Camera, "multiple-photos": Images, "location": MapPin, "audio": Mic,
};

/** Cor do ícone por família de resposta: escrita, escolha ou mídia. */
const TYPE_TONE: Record<FrontendQuestionType, string> = {
    "text": "bg-[#e4ece7] text-[#2e5546]", "number": "bg-[#e4ece7] text-[#2e5546]",
    "date": "bg-[#e4ece7] text-[#2e5546]", "time": "bg-[#e4ece7] text-[#2e5546]",
    "boolean": "bg-[#dfe6ef] text-[#2a3d57]", "single-choice": "bg-[#dfe6ef] text-[#2a3d57]",
    "multiple-choice": "bg-[#dfe6ef] text-[#2a3d57]", "rating-1-5": "bg-[#e6e0cc] text-[#5b4d1c]",
    "photo": "bg-[#f3e0d9] text-[#8a432f]", "multiple-photos": "bg-[#f3e0d9] text-[#8a432f]",
    "location": "bg-[#f3e0d9] text-[#8a432f]", "audio": "bg-[#f3e0d9] text-[#8a432f]",
};

/** Botão pequeno, com ícone, usado nas ações da questão. */
function MiniButton({
    label, onClick, disabled, danger, children,
}: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "grid size-8 place-items-center rounded-full text-muted-foreground transition-all disabled:cursor-not-allowed disabled:opacity-30 [&>svg]:size-4",
                danger ? "hover:bg-[#f3e0d9] hover:text-[#8a432f]" : "hover:bg-[#e4ece7] hover:text-ink"
            )}
        >
            {children}
        </button>
    );
}

/** Diz se o tipo de questão tem alternativas (escolha única ou múltipla). */
export const hasOptions = (type: FrontendQuestionType) => type === "single-choice" || type === "multiple-choice";

export interface QuestionActions {
    handleTypeChange: (sectionId: string, questionId: string, newType: FrontendQuestionType) => void;
    handleBlurQuestionField: (sectionId: string, questionId: string, field: string, value: any) => void;
    updateLocalQuestionState: (sectionId: string, questionId: string, field: keyof FormQuestion, value: any) => void;
    moveQuestion: (sectionId: string, qIndex: number, direction: "up" | "down") => void;
    handleDeleteQuestion: (sectionId: string, questionId: string) => void;
}

export interface OptionActions {
    handleAddOption: (sectionId: string, questionId: string) => void;
    handleBlurOptionText: (optionId: string, text: string) => void;
    handleUpdateOptionLocal: (sectionId: string, questionId: string, optionId: string, text: string) => void;
    handleDeleteOption: (sectionId: string, questionId: string, optionId: string) => void;
    moveOption: (sectionId: string, questionId: string, optIndex: number, direction: "up" | "down") => void;
}

interface QuestionCardProps {
    sectionId: string;
    q: FormQuestion;
    qIndex: number;
    totalQuestions: number;
    qActions: QuestionActions;
    optActions: OptionActions;
    rulesCtx: RulesContext;
    open: boolean;
    onToggle: () => void;
}

/** Campo com rótulo e dica opcional. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
            {children}
            {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
    );
}

/** Bloco com título, para agrupar campos. */
function Block({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="space-y-3 rounded-[18px] border border-border bg-white p-4">
            <h4 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-[var(--green-deep)]">{title}</h4>
            {children}
        </div>
    );
}

/**
 * Card de uma questão do questionário: resumo e, quando aberto, o editor (tipo, enunciado,
 * alternativas e regras).
 */
export function QuestionCard({ sectionId, q, qIndex, totalQuestions, qActions, optActions, rulesCtx, open, onToggle }: QuestionCardProps) {
    const readOnly = useReadOnly();
    const TypeIcon = QUESTION_TYPE_ICONS[q.type] ?? Type;
    const typeLabel = QUESTION_TYPES_LABEL.find((t) => t.type === q.type)?.label ?? q.type;
    const questionId = Number(q.id);
    const affectedByRules = rulesCtx.rules.filter((r) => r.targetQuestionId === questionId).length;
    const controlsRules = rulesCtx.rules.filter((r) => r.sourceQuestionId === questionId).length;

    const setLocal = (field: keyof FormQuestion, value: any) => qActions.updateLocalQuestionState(sectionId, q.id, field, value);
    const save = (field: string, value: any) => qActions.handleBlurQuestionField(sectionId, q.id, field, value);
    const toNumber = (text: string) => (text === "" ? undefined : parseInt(text));
    const toNullableNumber = (text: string) => (text === "" ? null : parseInt(text));

    const hasSettings = ["text", "rating-1-5", "multiple-choice", "number", "date", "multiple-photos", "audio"].includes(q.type);

    const summary = [typeLabel, hasOptions(q.type) ? `${q.options?.length ?? 0} opções` : null].filter(Boolean).join(" · ");

    return (
        <div className="pa-enter relative">
            {/* Linha-resumo: sempre visível */}
            <div
                className={cn(
                    "group flex items-center gap-2 rounded-2xl border p-2 pr-2.5 transition-all",
                    open
                        ? "border-border bg-white shadow-[0_14px_26px_-22px_rgba(10,20,16,0.5)]"
                        : "border-transparent hover:bg-muted/60"
                )}
            >
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                    <span
                        className={cn(
                            "relative z-10 grid size-7 shrink-0 place-items-center rounded-full border text-[11px] font-bold",
                            open ? "border-ink bg-ink text-white" : "border-[#c6d0c9] bg-white text-muted-foreground"
                        )}
                    >
                        {q.order}
                    </span>
                    <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", TYPE_TONE[q.type] ?? TYPE_TONE.text)}>
                        <TypeIcon className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className={cn("line-clamp-2 text-[14.5px] font-semibold tracking-tight sm:line-clamp-1", !q.title && "italic text-muted-foreground")}>
                            {q.title || "Questão sem enunciado"}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{summary}</span>
                    </span>
                    <span className="hidden shrink-0 items-center gap-1.5 md:flex">
                        {q.required && (
                            <span className="rounded-full bg-[#f3e0d9] px-2.5 py-0.5 text-[11px] font-semibold text-[#8a432f]">Obrigatória</span>
                        )}
                        {affectedByRules > 0 && (
                            <span
                                className="inline-flex items-center gap-1 rounded-full bg-[#e6e0cc] px-2.5 py-0.5 text-[11px] font-semibold text-[#5b4d1c]"
                                title="Só aparece quando uma regra de exibição é atendida"
                            >
                                <GitBranch className="size-3" /> Condicional
                            </span>
                        )}
                        {controlsRules > 0 && (
                            <span
                                className="inline-flex items-center gap-1 rounded-full bg-[#dfe6ef] px-2.5 py-0.5 text-[11px] font-semibold text-[#2a3d57]"
                                title="Suas respostas controlam a exibição de outras questões"
                            >
                                <GitBranch className="size-3" /> Controla {controlsRules}
                            </span>
                        )}
                    </span>
                    <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
                </button>

                {!readOnly && (
                    <div className="flex shrink-0 items-center md:opacity-0 md:transition-opacity md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                        <MiniButton label="Mover para cima" onClick={() => qActions.moveQuestion(sectionId, qIndex, "up")} disabled={qIndex === 0}><ArrowUp /></MiniButton>
                        <MiniButton label="Mover para baixo" onClick={() => qActions.moveQuestion(sectionId, qIndex, "down")} disabled={qIndex === totalQuestions - 1}><ArrowDown /></MiniButton>
                        <MiniButton danger label="Excluir questão" onClick={() => qActions.handleDeleteQuestion(sectionId, q.id)}><Trash2 /></MiniButton>
                    </div>
                )}
            </div>

            {/* Edição: aparece ao expandir */}
            {open && (
                <fieldset disabled={readOnly} className="mb-3 ml-3 mt-2 m-0 min-w-0 space-y-5 rounded-[22px] border border-border bg-[#f6f9f7] p-4 sm:ml-10 sm:p-5">
                    <Field label="Enunciado">
                        <Input
                            className="h-11 bg-white text-[15px] font-medium"
                            value={q.title || ""}
                            onChange={(e) => setLocal("title", e.target.value)}
                            onBlur={(e) => save("title", e.target.value)}
                            placeholder="Digite a pergunta que será feita ao entrevistado"
                        />
                    </Field>

                    <Field label="Texto de ajuda (opcional)">
                        <Input
                            className="bg-white"
                            value={q.helpText || ""}
                            onChange={(e) => setLocal("helpText", e.target.value)}
                            onBlur={(e) => save("helpText", e.target.value)}
                            placeholder="Uma orientação curta para o pesquisador"
                        />
                    </Field>

                    <Field label="Tipo de resposta">
                        <div role="radiogroup" aria-label="Tipo de resposta" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                            {QUESTION_TYPES_LABEL.map((item) => {
                                const Icon = QUESTION_TYPE_ICONS[item.type];
                                const on = item.type === q.type;
                                return (
                                    <button
                                        key={item.type}
                                        type="button"
                                        role="radio"
                                        aria-checked={on}
                                        onClick={() => !on && qActions.handleTypeChange(sectionId, q.id, item.type)}
                                        className={cn(
                                            "flex items-center gap-2.5 rounded-xl border p-2 pr-3 text-left text-[13px] font-medium transition-all",
                                            on
                                                ? "border-ink bg-ink text-white shadow-sm"
                                                : "border-border bg-white text-foreground hover:border-[#c6d0c9] hover:bg-[#e4ece7]"
                                        )}
                                    >
                                        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", on ? "bg-[var(--mint)] text-[var(--forest)]" : TYPE_TONE[item.type])}>
                                            <Icon className="size-4" />
                                        </span>
                                        <span className="truncate">{item.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </Field>

                    <label
                        className={cn(
                            "flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition-colors",
                            q.required ? "border-[#e8c4b8] bg-[#fbeee9]" : "border-border bg-white"
                        )}
                    >
                        <span>
                            <span className="block text-sm font-semibold">Resposta obrigatória</span>
                            <span className="block text-[11.5px] text-muted-foreground">Questões escondidas por regra não são cobradas.</span>
                        </span>
                        <Switch
                            checked={q.required}
                            onCheckedChange={(c) => {
                                setLocal("required", c);
                                save("isRequired", c);
                            }}
                        />
                    </label>

                    {/* Configurações específicas do tipo */}
                    {hasSettings && (
                        <Block title="Limites e configurações">
                            <div className="grid gap-4 sm:grid-cols-2">
                                {q.type === "text" && (
                                    <Field label="Limite de caracteres (opcional)">
                                        <Input type="number" min="1" value={q.maxLength || ""} onChange={(e) => setLocal("maxLength", toNumber(e.target.value))} onBlur={(e) => save("maxLength", toNullableNumber(e.target.value))} />
                                    </Field>
                                )}

                                {q.type === "rating-1-5" && (
                                    <>
                                        <Field label="Rótulo do menor valor (1)">
                                            <Input placeholder="Ex: Muito ruim" value={q.scaleLeftLabel || ""} onChange={(e) => setLocal("scaleLeftLabel", e.target.value)} onBlur={(e) => save("scaleLeftLabel", e.target.value === "" ? null : e.target.value)} />
                                        </Field>
                                        <Field label="Rótulo do maior valor (5)">
                                            <Input placeholder="Ex: Muito bom" value={q.scaleRightLabel || ""} onChange={(e) => setLocal("scaleRightLabel", e.target.value)} onBlur={(e) => save("scaleRightLabel", e.target.value === "" ? null : e.target.value)} />
                                        </Field>
                                    </>
                                )}

                                {q.type === "multiple-choice" && (
                                    <>
                                        <Field label="Mínimo de escolhas">
                                            <Input type="number" min="1" value={q.minSelections || 1} onChange={(e) => setLocal("minSelections", parseInt(e.target.value) || 1)} onBlur={(e) => save("minSelections", parseInt(e.target.value) || 1)} />
                                        </Field>
                                        <Field label="Máximo de escolhas">
                                            <Input type="number" min="1" value={q.maxSelections || 2} onChange={(e) => setLocal("maxSelections", parseInt(e.target.value) || 2)} onBlur={(e) => save("maxSelections", parseInt(e.target.value) || 2)} />
                                        </Field>
                                    </>
                                )}

                                {q.type === "number" && (
                                    <>
                                        <Field label="Valor mínimo (opcional)">
                                            <Input type="number" value={q.minValue ?? ""} onChange={(e) => setLocal("minValue", toNumber(e.target.value))} onBlur={(e) => save("minValue", toNullableNumber(e.target.value))} />
                                        </Field>
                                        <Field label="Valor máximo (opcional)">
                                            <Input type="number" value={q.maxValue ?? ""} onChange={(e) => setLocal("maxValue", toNumber(e.target.value))} onBlur={(e) => save("maxValue", toNullableNumber(e.target.value))} />
                                        </Field>
                                    </>
                                )}

                                {q.type === "date" && (
                                    <>
                                        <Field label="A partir da data (opcional)">
                                            <Input type="date" value={q.minDate || ""} onChange={(e) => setLocal("minDate", e.target.value)} onBlur={(e) => save("minDate", e.target.value === "" ? null : e.target.value)} />
                                        </Field>
                                        <Field label="Até a data (opcional)">
                                            <Input type="date" value={q.maxDate || ""} onChange={(e) => setLocal("maxDate", e.target.value)} onBlur={(e) => save("maxDate", e.target.value === "" ? null : e.target.value)} />
                                        </Field>
                                    </>
                                )}

                                {q.type === "multiple-photos" && (
                                    <Field label="Quantidade máxima de fotos (opcional)">
                                        <Input type="number" min="2" value={q.maxFiles || ""} onChange={(e) => setLocal("maxFiles", toNumber(e.target.value))} onBlur={(e) => save("maxFiles", toNullableNumber(e.target.value))} />
                                    </Field>
                                )}

                                {q.type === "audio" && (
                                    <Field label="Duração máxima (segundos)">
                                        <Input type="number" min="1" placeholder="Ex: 60" value={q.maxDuration || ""} onChange={(e) => setLocal("maxDuration", toNumber(e.target.value))} onBlur={(e) => save("maxDuration", toNullableNumber(e.target.value))} />
                                    </Field>
                                )}
                            </div>
                        </Block>
                    )}

                    {/* Opções de resposta */}
                    {hasOptions(q.type) && (
                        <Block title="Opções de resposta">
                            <div className="space-y-2">
                                {q.options?.map((opt, optIndex) => (
                                    <div key={opt.id} className="flex items-center gap-2 rounded-xl bg-[#f6f9f7] p-1.5 pl-2">
                                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#dfe6ef] text-[11px] font-bold text-[#2a3d57]">{optIndex + 1}</span>
                                        <Input
                                            className="h-9 flex-1 bg-white"
                                            value={opt.text}
                                            onChange={(e) => optActions.handleUpdateOptionLocal(sectionId, q.id, opt.id, e.target.value)}
                                            onBlur={(e) => optActions.handleBlurOptionText(opt.id, e.target.value)}
                                            placeholder={`Opção ${optIndex + 1}`}
                                            required
                                        />
                                        {!readOnly && <div className="flex items-center">
                                            <MiniButton label="Mover para cima" onClick={() => optActions.moveOption(sectionId, q.id, optIndex, "up")} disabled={optIndex === 0}><ArrowUp /></MiniButton>
                                            <MiniButton label="Mover para baixo" onClick={() => optActions.moveOption(sectionId, q.id, optIndex, "down")} disabled={optIndex === (q.options?.length || 0) - 1}><ArrowDown /></MiniButton>
                                            <MiniButton danger label="Excluir opção" onClick={() => optActions.handleDeleteOption(sectionId, q.id, opt.id)}><Trash2 /></MiniButton>
                                        </div>}
                                    </div>
                                ))}
                            </div>
                            {!readOnly && (
                                <button
                                    type="button"
                                    onClick={() => optActions.handleAddOption(sectionId, q.id)}
                                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#b9c9bf] py-2 text-[13px] font-semibold text-[var(--green-deep)] transition-colors hover:bg-[#e4ece7]"
                                >
                                    <Plus className="size-4" /> Adicionar opção
                                </button>
                            )}
                        </Block>
                    )}

                    {/* Regras de exibição: quando esta questão aparece para o entrevistado */}
                    <RegrasExibicao question={q} ctx={rulesCtx} />
                </fieldset>
            )}
        </div>
    );
}

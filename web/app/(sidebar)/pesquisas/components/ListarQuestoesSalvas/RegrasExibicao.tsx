import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CornerDownRight, EyeOff, GitBranch, Plus, SkipForward, X } from "lucide-react";
import type { DisplayRule, FormQuestion, FormSection, RuleOperator } from "@/lib/questionnaire";
import { useReadOnly } from "./ReadOnlyContext";

export type RuleAction = "SHOW" | "HIDE";
export interface RuleConditionDraft { sourceQuestionId: number; operator: RuleOperator; triggerValue: string }

// Contexto das regras repassado de ListarQuestoesSalvas até cada questão e seção.
export interface RulesContext {
    sections: FormSection[];
    rules: DisplayRule[];
    /** Cria uma regra: alvo (questão OU seção), ação e uma ou mais condições que valem juntas (E). */
    onAddRule: (target: { questionId?: string; sectionId?: string }, action: RuleAction, conditions: RuleConditionDraft[]) => Promise<boolean>;
    onDeleteRule: (ruleId: number) => Promise<void>;
}

const shorten = (text: string, max = 50) => (text.length > max ? `${text.slice(0, max)}…` : text);

// Mesma tabela da API (api/src/question-rule/rule-logic.ts): quais operadores servem para cada tipo de questão.
const OPERATOR_LABELS: Record<RuleOperator, string> = {
    EQ: "é igual a", NEQ: "é diferente de", GT: "é maior que", GTE: "é maior ou igual a", LT: "é menor que", LTE: "é menor ou igual a",
    CONTAINS: "contém", NOT_CONTAINS: "não contém", ANSWERED: "foi respondida", NOT_ANSWERED: "não foi respondida",
};

function operatorsFor(type: string): RuleOperator[] {
    const list: RuleOperator[] = [];
    if (["boolean", "single-choice", "multiple-choice", "rating-1-5", "number", "text"].includes(type)) list.push("EQ", "NEQ");
    if (["number", "rating-1-5"].includes(type)) list.push("GT", "GTE", "LT", "LTE");
    if (type === "text") list.push("CONTAINS", "NOT_CONTAINS");
    list.push("ANSWERED", "NOT_ANSWERED");
    return list;
}

const needsValue = (op: RuleOperator) => op !== "ANSWERED" && op !== "NOT_ANSWERED";

function valueChoices(q: FormQuestion): { value: string; label: string }[] | null {
    if (q.type === "boolean") return [{ value: "YES", label: "Sim" }, { value: "NO", label: "Não" }];
    if (q.type === "rating-1-5") {
        // Mostra o rótulo configurado nas pontas da escala (ex.: "1 — Muito ruim", "5 — Muito bom").
        const ends: Record<string, string | undefined> = { "1": q.scaleLeftLabel?.trim() || undefined, "5": q.scaleRightLabel?.trim() || undefined };
        return ["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: ends[n] ? `${n} — ${ends[n]}` : n }));
    }
    if (q.type === "single-choice" || q.type === "multiple-choice") return (q.options ?? []).map((o) => ({ value: o.id, label: o.text || "(opção sem texto)" }));
    return null; // número e texto: digitado
}

const isChoiceOnly = (q: FormQuestion, op: RuleOperator) =>
    (q.type === "boolean" || q.type === "single-choice" || q.type === "multiple-choice") && (op === "EQ" || op === "NEQ");

function findQuestion(sections: FormSection[], id: number | null) {
    if (id === null) return null;
    for (const section of sections) {
        const question = section.questions.find((q) => q.id === String(id));
        if (question) return { section, question };
    }
    return null;
}

const positionOf = (sections: FormSection[], id: number | null, fallback: string) => {
    const found = findQuestion(sections, id);
    return found ? `Seção ${found.section.order} · Q${found.question.order}` : fallback;
};

function valueText(sections: FormSection[], rule: DisplayRule) {
    if (!needsValue(rule.operator as RuleOperator)) return "";
    const source = findQuestion(sections, rule.sourceQuestionId)?.question;
    if (!source) return rule.triggerLabel;
    const choices = valueChoices(source);
    return choices?.find((o) => o.value === rule.triggerValue)?.label ?? rule.triggerValue;
}

/** Agrupa as regras de um alvo: condições com a mesma groupKey formam um grupo (E); cada grupo é uma alternativa (OU). */
function groupRules(rules: DisplayRule[]): DisplayRule[][] {
    const groups: DisplayRule[][] = [];
    const byKey = new Map<string, DisplayRule[]>();
    for (const rule of rules) {
        const key = rule.groupKey ? `${rule.action}|${rule.groupKey}` : null;
        if (key && byKey.has(key)) { byKey.get(key)!.push(rule); continue; }
        const group = [rule];
        if (key) byKey.set(key, group);
        groups.push(group);
    }
    return groups;
}

type Draft = { sourceId: string; operator: RuleOperator | ""; value: string };
const emptyDraft = (): Draft => ({ sourceId: "", operator: "", value: "" });
const MAX_CONDITIONS = 5;

interface Props { question?: FormQuestion; section?: FormSection; ctx: RulesContext }

export function RegrasExibicao({ question, section, ctx }: Props) {
    const readOnly = useReadOnly();
    const isSection = !!section;
    const [adding, setAdding] = useState(false);
    const [action, setAction] = useState<RuleAction>(isSection ? "HIDE" : "SHOW");
    const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()]);
    const [saving, setSaving] = useState(false);

    const targetQuestionId = question ? Number(question.id) : null;
    const targetSectionId = section ? Number(section.id) : null;

    const affecting = ctx.rules.filter((r) => (isSection ? r.targetSectionId === targetSectionId : r.targetQuestionId === targetQuestionId));
    const triggered = question ? ctx.rules.filter((r) => r.sourceQuestionId === targetQuestionId) : [];
    const groups = groupRules(affecting);

    // Só questões que vêm ANTES do alvo (da questão, ou da seção inteira) podem ser origem.
    const candidates: { question: FormQuestion; position: string; title: string }[] = [];
    outer: for (const sec of [...ctx.sections].sort((a, b) => a.order - b.order)) {
        if (section && sec.order >= section.order) break;
        for (const q of [...sec.questions].sort((a, b) => a.order - b.order)) {
            if (question && q.id === question.id) break outer;
            candidates.push({ question: q, position: `Seção ${sec.order} · Q${q.order}`, title: shorten(q.title || "Sem enunciado", 90) });
        }
    }
    const candidateItems = candidates.map((c) => ({ value: c.question.id, label: `${c.position} — ${c.title}` }));

    const reset = () => { setAdding(false); setDrafts([emptyDraft()]); setAction(isSection ? "HIDE" : "SHOW"); };
    const setDraft = (i: number, patch: Partial<Draft>) => setDrafts((prev) => prev.map((d, k) => (k === i ? { ...d, ...patch } : d)));

    const complete = drafts.every((d) => d.sourceId && d.operator && (!needsValue(d.operator as RuleOperator) || d.value.trim() !== ""));

    const save = async () => {
        if (!complete) return;
        setSaving(true);
        const ok = await ctx.onAddRule(
            isSection ? { sectionId: section!.id } : { questionId: question!.id },
            action,
            drafts.map((d) => ({ sourceQuestionId: Number(d.sourceId), operator: d.operator as RuleOperator, triggerValue: needsValue(d.operator as RuleOperator) ? d.value.trim() : "" })),
        );
        setSaving(false);
        if (ok) reset();
    };

    const summary = drafts.map((d) => {
        const src = candidates.find((c) => c.question.id === d.sourceId);
        if (!src || !d.operator) return null;
        const choices = valueChoices(src.question);
        const label = needsValue(d.operator) ? (choices?.find((o) => o.value === d.value)?.label ?? d.value) : "";
        return `${src.position} ${OPERATOR_LABELS[d.operator]}${label ? ` ${label}` : ""}`;
    });
    const summaryReady = summary.every(Boolean) && complete;
    const targetName = isSection ? "Esta seção inteira" : "Esta questão";

    return (
        <div className="relative space-y-3 overflow-hidden rounded-[18px] border border-dashed border-[#b9c9bf] bg-[#eef5f0] p-4">
            <div className="flex items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-[var(--green-deep)]">
                    <span className="grid size-6 place-items-center rounded-lg bg-[var(--forest)] text-[var(--mint)]">{isSection ? <SkipForward className="size-3.5" /> : <GitBranch className="size-3.5" />}</span>
                    {isSection ? "Pulo de seção" : "Lógica de exibição"}
                </h4>
                {!adding && !readOnly && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)} className="bg-white">
                        <Plus className="mr-1 size-4" /> Adicionar regra
                    </Button>
                )}
            </div>

            {groups.length === 0 ? (
                <p className="flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 text-xs text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-[var(--green)]" /> Sem regra: {isSection ? "esta seção aparece sempre." : "esta questão aparece sempre."}
                </p>
            ) : (
                <div className="space-y-1.5">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <EyeOff className="h-3.5 w-3.5" /> {isSection ? "Regras desta seção (vale a primeira que se aplicar):" : "Regras desta questão:"}
                    </p>
                    {groups.map((group, gi) => (
                        <div key={group[0].id}>
                            {gi > 0 && <p className="py-0.5 text-center text-[10px] font-bold tracking-widest text-muted-foreground">OU</p>}
                            <div className="flex items-start justify-between gap-2 rounded-xl border border-border bg-white px-3 py-2 text-xs shadow-sm">
                                <span className="flex flex-col gap-1">
                                    {group.map((rule, ri) => {
                                        const src = findQuestion(ctx.sections, rule.sourceQuestionId)?.question;
                                        return (
                                            <span key={rule.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${ri === 0 ? (rule.action === "HIDE" ? "bg-[#8a432f] text-white" : "bg-[var(--forest)] text-[var(--mint)]") : "bg-[#e4ece7] text-[var(--green-deep)]"}`}>
                                                    {ri === 0 ? (rule.action === "HIDE" ? "ESCONDE SE" : "MOSTRA SE") : "E"}
                                                </span>
                                                <strong>{positionOf(ctx.sections, rule.sourceQuestionId, rule.sourceLabel)}</strong>
                                                «{shorten(src?.title ?? rule.sourceStatement, 36)}» {OPERATOR_LABELS[rule.operator as RuleOperator] ?? rule.operatorLabel}
                                                {needsValue(rule.operator as RuleOperator) && <strong>{valueText(ctx.sections, rule)}</strong>}
                                            </span>
                                        );
                                    })}
                                </span>
                                {!readOnly && (
                                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-destructive hover:bg-destructive/10" onClick={() => ctx.onDeleteRule(group[0].id)} title={group.length > 1 ? "Remover regra (todas as condições)" : "Remover regra"}>
                                        <X className="h-3.5 w-3.5" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                    {groups.length > 1 && (
                        <p className="text-[11px] text-muted-foreground">
                            Com mais de uma regra de “mostrar”, basta uma ser verdadeira. Se alguma regra de “esconder” for verdadeira, {isSection ? "a seção some" : "a questão some"} (e deixa de ser obrigatória).
                        </p>
                    )}
                </div>
            )}

            {triggered.length > 0 && (
                <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Esta questão controla:</p>
                    {triggered.map((rule) => (
                        <p key={rule.id} className="text-xs">
                            <CornerDownRight className="mr-1.5 inline size-3 align-[-2px] text-muted-foreground" />
                            Se {OPERATOR_LABELS[rule.operator as RuleOperator] ?? rule.operatorLabel} {needsValue(rule.operator as RuleOperator) && <strong>{valueText(ctx.sections, rule)}</strong>}, {rule.action === "HIDE" ? "esconde" : "mostra"} <strong>{rule.targetKind === "SECTION" ? rule.targetLabel : positionOf(ctx.sections, rule.targetQuestionId, rule.targetLabel)}</strong>
                        </p>
                    ))}
                </div>
            )}

            {adding && (
                <div className="space-y-4 rounded-2xl border border-border bg-white p-3 shadow-sm sm:p-4">
                    <p className="text-sm font-semibold tracking-tight">{isSection ? "Nova regra de pulo de seção" : "Nova regra de exibição"}</p>

                    {candidates.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Não há questão anterior que possa ser usada como origem de uma regra.</p>
                    ) : (
                        <>
                            <div className="space-y-1.5">
                                <Label className="text-xs">O que a regra faz</Label>
                                <Select
                                    items={[{ value: "SHOW", label: `Mostrar ${isSection ? "a seção" : "a questão"} somente quando…` }, { value: "HIDE", label: `Esconder / pular ${isSection ? "a seção" : "a questão"} quando…` }]}
                                    value={action}
                                    onValueChange={(v) => setAction((v as RuleAction) ?? "SHOW")}
                                >
                                    <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                                    <SelectContent alignItemWithTrigger={false}>
                                        <SelectItem value="SHOW">Mostrar {isSection ? "a seção" : "a questão"} somente quando…</SelectItem>
                                        <SelectItem value="HIDE">Esconder / pular {isSection ? "a seção" : "a questão"} quando…</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {drafts.map((draft, i) => {
                                const src = candidates.find((c) => c.question.id === draft.sourceId)?.question;
                                const operators = src ? operatorsFor(src.type) : [];
                                const choices = src ? valueChoices(src) : null;
                                const useChoices = !!src && !!choices && (isChoiceOnly(src, draft.operator as RuleOperator) || src.type === "rating-1-5");
                                return (
                                    <div key={i} className="space-y-2 rounded-xl border border-dashed border-border bg-muted/20 p-3">
                                        <div className="flex items-center justify-between">
                                            <span className="rounded-md bg-[var(--forest)] px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-[var(--mint)]">{i === 0 ? "CONDIÇÃO" : "E TAMBÉM"}</span>
                                            {i > 0 && <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setDrafts((prev) => prev.filter((_, k) => k !== i))} title="Remover condição"><X className="h-3.5 w-3.5" /></Button>}
                                        </div>

                                        <Select items={candidateItems} value={draft.sourceId || undefined} onValueChange={(v) => setDraft(i, { sourceId: v ?? "", operator: "", value: "" })}>
                                            <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Questão de origem (que vem antes)" /></SelectTrigger>
                                            <SelectContent alignItemWithTrigger={false} className="max-h-64">
                                                {candidates.map((c) => (
                                                    <SelectItem key={c.question.id} value={c.question.id}>
                                                        <span className="flex max-w-[calc(var(--anchor-width)-3rem)] flex-col items-start py-0.5 leading-tight">
                                                            <span className="text-[11px] font-semibold text-primary">{c.position}</span>
                                                            <span className="max-w-full truncate" title={c.title}>{c.title}</span>
                                                        </span>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>

                                        <div className="grid gap-2 sm:grid-cols-2">
                                            <Select
                                                items={operators.map((o) => ({ value: o, label: OPERATOR_LABELS[o] }))}
                                                value={draft.operator || undefined}
                                                onValueChange={(v) => setDraft(i, { operator: (v as RuleOperator) ?? "", value: "" })}
                                                disabled={!src}
                                            >
                                                <SelectTrigger className="h-9 w-full"><SelectValue placeholder={src ? "Condição" : "Escolha a origem primeiro"} /></SelectTrigger>
                                                <SelectContent alignItemWithTrigger={false} className="max-h-64">
                                                    {operators.map((o) => <SelectItem key={o} value={o}>{OPERATOR_LABELS[o]}</SelectItem>)}
                                                </SelectContent>
                                            </Select>

                                            {draft.operator && needsValue(draft.operator) && (useChoices ? (
                                                <Select items={choices!} value={draft.value || undefined} onValueChange={(v) => setDraft(i, { value: v ?? "" })}>
                                                    <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Valor" /></SelectTrigger>
                                                    <SelectContent alignItemWithTrigger={false} className="max-h-64">
                                                        {choices!.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            ) : (
                                                <Input className="h-9" type={src?.type === "number" || src?.type === "rating-1-5" ? "number" : "text"} placeholder="Valor" value={draft.value} onChange={(e) => setDraft(i, { value: e.target.value })} />
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}

                            {drafts.length < MAX_CONDITIONS && (
                                <Button type="button" variant="outline" size="sm" onClick={() => setDrafts((prev) => [...prev, emptyDraft()])}>
                                    <Plus className="mr-1 size-4" /> Exigir também outra condição (E)
                                </Button>
                            )}

                            <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                                {summaryReady ? (
                                    <>
                                        {targetName} {action === "SHOW" ? "só vai aparecer" : "vai ser escondida"} quando{" "}
                                        {summary.map((text, i) => (<span key={i}>{i > 0 && " e "}<strong className="text-foreground">{text}</strong></span>))}.
                                        {action === "HIDE" ? " Escondida, deixa de ser obrigatória e as respostas dela não são enviadas." : " Nos outros casos fica escondida e deixa de ser obrigatória."}
                                    </>
                                ) : "Preencha a origem, a condição e o valor para ver o resumo da regra."}
                            </div>
                        </>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={reset}>Cancelar</Button>
                        <Button type="button" size="sm" disabled={!complete || saving || candidates.length === 0} onClick={save}>
                            {saving ? "Salvando..." : "Salvar regra"}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
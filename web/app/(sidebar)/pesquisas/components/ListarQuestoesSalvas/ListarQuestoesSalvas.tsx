'use client'

import { CountUp } from "@/components/ui/count-up";
import { useEffect, useState } from "react";
import {
    loadQuestionnaire,
    updateSectionApi,
    deleteSectionApi,
    updateQuestionApi,
    deleteQuestionApi,
    createQuestion,
    createSection,
    toBackendType,
    createOptionApi,
    updateOptionApi,
    deleteOptionApi,
    getRulesApi,
    createRuleApi,
    deleteRuleApi,
    reorderSectionsApi,
    reorderQuestionsApi,
    withRulesConfirm,
    type DisplayRule,
    type RuleOperator,
    type FormSection,
    type FormQuestion,
    type FrontendQuestionType
} from "@/lib/questionnaire";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { LoadingState } from "@/components/ui/loadingState";
import { Button } from "@/components/ui/button";
import { ChevronsDownUp, ChevronsUpDown, FolderPlus, Info, Lock } from "lucide-react";
import { Contour } from "@/components/ui/contour";
import toast from "react-hot-toast";

import { SectionCard } from "./SectionCard";
import { QuestionActions, OptionActions, hasOptions } from "./QuestionCard";
import type { RulesContext } from "./RegrasExibicao";
import { ReadOnlyProvider } from "./ReadOnlyContext";

export default function ListarQuestoesSalvas({ researchId, readOnly = false, readOnlyMessage }: { researchId: string | number; readOnly?: boolean; readOnlyMessage?: string }) {
    const [sections, setSections] = useState<FormSection[]>([]);
    const [rules, setRules] = useState<DisplayRule[]>([]);
    // Questões abertas para edição (as demais aparecem só como linha-resumo).
    const [openQuestionIds, setOpenQuestionIds] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadQuestionnaire(Number(researchId))
            .then(setSections)
            .catch(() => toast.error("Erro ao carregar questionário salvo."))
            .finally(() => setIsLoading(false));
        getRulesApi(Number(researchId)).then(setRules).catch(() => setRules([]));
    }, [researchId]);

    const reload = async () => {
        const reloaded = await loadQuestionnaire(Number(researchId));
        setSections(reloaded);
    };

    const toggleQuestion = (questionId: string) => {
        setOpenQuestionIds(prev => {
            const next = new Set(prev);
            if (next.has(questionId)) next.delete(questionId);
            else next.add(questionId);
            return next;
        });
    };

    const openQuestion = (questionId: string | number) => {
        setOpenQuestionIds(prev => new Set(prev).add(String(questionId)));
    };

    const expandAll = () => setOpenQuestionIds(new Set(sections.flatMap(s => s.questions.map(q => q.id))));
    const collapseAll = () => setOpenQuestionIds(new Set());

    // Recarrega as regras depois de qualquer mudança que possa apagá-las (exclusão, reordenação, troca de tipo).
    const reloadRules = async () => {
        try {
            setRules(await getRulesApi(Number(researchId)));
        } catch {
            /* mantém as regras atuais na tela */
        }
    };

    // ================= SEÇÕES =================
    const handleAddSection = async () => {
        try {
            const maxOrder = sections.reduce((max, s) => Math.max(max, s.order), 0);
            const nextOrder = maxOrder + 1;
            const newSec = await createSection(`Nova Seção ${nextOrder}`, nextOrder, Number(researchId));

            const firstQuestion = await createQuestion({
                statement: "Nova Pergunta",
                type: "FREE_TEXT",
                isRequired: false,
                order: 1,
                sectionId: newSec.id,
            });

            toast.success("Seção criada e salva com sucesso!");
            await reload();
            openQuestion(firstQuestion.id);
        } catch (e) {
            toast.error("Erro ao criar nova seção.");
        }
    };

    const handleBlurSectionTitle = async (sectionId: string, title: string) => {
        if (sectionId.length > 10 && sectionId.includes("-")) return;
        try {
            await updateSectionApi(Number(sectionId), { title });
            toast.success("Título da seção atualizado!", { id: "sec-title", duration: 1500 });
        } catch (e) {
            toast.error("Erro ao atualizar título da seção.");
        }
    };

    const moveSection = async (index: number, direction: "up" | "down") => {
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= sections.length) return;

        const updated = [...sections];
        const [moved] = updated.splice(index, 1);
        updated.splice(targetIndex, 0, moved);

        try {
            // Uma chamada só: a API valida as regras de exibição no resultado final.
            const orderedIds = updated.map((sec) => Number(sec.id));
            const result = await withRulesConfirm((force) => reorderSectionsApi(Number(researchId), orderedIds, force));
            if (result.cancelled) return;

            setSections(updated.map((s, i) => ({ ...s, order: i + 1 })));
            await reloadRules();
            toast.success("Ordem da seção atualizada!", { id: "sec-order", duration: 1500 });
        } catch (e) {
            toast.error("Erro ao reordenar seções.");
        }
    };

    const handleDeleteSection = async (sectionId: string) => {
        const message = sections.length === 1
            ? "Atenção: Esta é a única seção da pesquisa. Se você excluí-la, o questionário ficará vazio. Deseja continuar?"
            : "Tem certeza que deseja excluir esta seção e todas as suas questões?";

        const confirmedDelete = await confirmDialog({
            title: "Excluir seção",
            description: message,
            confirmLabel: "Excluir",
            variant: "destructive",
        });
        if (!confirmedDelete) return;

        try {
            const result = await withRulesConfirm((force) => deleteSectionApi(Number(sectionId), force));
            if (result.cancelled) return;

            setSections(prev => prev.filter(s => s.id !== sectionId).map((s, i) => ({ ...s, order: i + 1 })));
            await reloadRules();
            toast.success("Seção excluída com sucesso!");
        } catch (e: any) {
            const backendMsg = e?.message || "";
            toast.error(backendMsg.includes("answers") ? "Não é possível excluir: contém questões já respondidas." : "Erro ao excluir seção.");
        }
    };

    // ================= QUESTÕES =================
    const handleTypeChange = async (sectionId: string, questionId: string, newType: FrontendQuestionType) => {
        const section = sections.find(s => s.id === sectionId);
        const question = section?.questions.find(q => q.id === questionId);

        if (question && question.type !== newType) {
            const confirmed = await confirmDialog({
                title: "Mudar o tipo da questão",
                description: "Mudar o tipo desta questão pode fazer com que configurações ou respostas anteriores sejam perdidas. Deseja continuar?",
                confirmLabel: "Mudar tipo",
                variant: "destructive",
            });
            if (!confirmed) return;
        }

        updateLocalQuestionState(sectionId, questionId, "type", newType);

        const isMultiple = newType === "multiple-choice";
        const extraPayload: any = { type: toBackendType(newType) };

        if (isMultiple && question && !question.minSelections) {
            extraPayload.minSelections = 1;
            extraPayload.maxSelections = 2;
            updateLocalQuestionState(sectionId, questionId, "minSelections", 1);
            updateLocalQuestionState(sectionId, questionId, "maxSelections", 2);
        }

        if (questionId.length > 10 && questionId.includes("-")) return;

        try {
            const result = await withRulesConfirm((force) => updateQuestionApi(Number(questionId), extraPayload, force));
            if (result.cancelled) {
                await reload(); // desfaz a troca de tipo feita na tela
                return;
            }
            await reloadRules();
            toast.success("Tipo de questão atualizado!", { id: "q-save", duration: 1000 });

            if (hasOptions(newType) && (!question?.options || question.options.length === 0)) {
                await handleAddOption(sectionId, questionId);
            }
        } catch (e) {
            toast.error("Erro ao alterar o tipo da questão.");
        }
    };

    const handleBlurQuestionField = async (sectionId: string, questionId: string, field: string, value: any) => {
        if (questionId.length > 10 && questionId.includes("-")) return;

        const section = sections.find(s => s.id === sectionId);
        const question = section?.questions.find(q => q.id === questionId);

        if (question) {
            if (question.type === "multiple-choice") {
                const currentMin = field === "minSelections" ? value : (question.minSelections || 1);
                const currentMax = field === "maxSelections" ? value : (question.maxSelections || 1);
                if (currentMax < currentMin) {
                    toast.error("O limite máximo não pode ser menor que o mínimo.");
                    updateLocalQuestionState(sectionId, questionId, field as keyof FormQuestion, field === "minSelections" ? 1 : Math.max(2, currentMin));
                    return;
                }
            }
            if (question.type === "number") {
                const currentMin = field === "minValue" ? value : question.minValue;
                const currentMax = field === "maxValue" ? value : question.maxValue;
                if (currentMin != null && currentMax != null && currentMax < currentMin) {
                    toast.error("O valor máximo não pode ser menor que o mínimo.");
                    updateLocalQuestionState(sectionId, questionId, field as keyof FormQuestion, undefined);
                    return;
                }
            }
            if (question.type === "date") {
                const currentMin = field === "minDate" ? value : question.minDate;
                const currentMax = field === "maxDate" ? value : question.maxDate;
                if (currentMin && currentMax && new Date(currentMax) < new Date(currentMin)) {
                    toast.error("A data máxima não pode ser anterior à mínima.");
                    updateLocalQuestionState(sectionId, questionId, field as keyof FormQuestion, undefined);
                    return;
                }
            }
        }

        try {
            const payload: any = {};
            const backendField = field === "title" ? "statement" : field;
            payload[backendField] = field === "type" ? toBackendType(value) : value;

            await updateQuestionApi(Number(questionId), payload);
            toast.success("Configuração salva!", { id: "q-save", duration: 1000 });
        } catch (e) {
            toast.error("Erro ao salvar alteração na questão.");
        }
    };

    const updateLocalQuestionState = (sectionId: string, questionId: string, field: keyof FormQuestion, value: any) => {
        setSections(prev => prev.map(s => s.id === sectionId ? {
            ...s, questions: s.questions.map(q => q.id === questionId ? { ...q, [field]: value } : q)
        } : s));
    };

    const moveQuestion = async (sectionId: string, qIndex: number, direction: "up" | "down") => {
        const section = sections.find(s => s.id === sectionId);
        if (!section) return;

        const targetIndex = direction === "up" ? qIndex - 1 : qIndex + 1;
        if (targetIndex < 0 || targetIndex >= section.questions.length) return;

        const updatedQuestions = [...section.questions];
        const [moved] = updatedQuestions.splice(qIndex, 1);
        updatedQuestions.splice(targetIndex, 0, moved);

        try {
            // Uma chamada só: a API valida as regras de exibição no resultado final.
            const orderedIds = updatedQuestions.map((q) => Number(q.id));
            const result = await withRulesConfirm((force) => reorderQuestionsApi(Number(sectionId), orderedIds, force));
            if (result.cancelled) return;

            setSections(prev => prev.map(s => s.id === sectionId ? { ...s, questions: updatedQuestions.map((q, i) => ({ ...q, order: i + 1 })) } : s));
            await reloadRules();
            toast.success("Ordem da questão atualizada!", { id: "q-order", duration: 1000 });
        } catch (e) {
            toast.error("Erro ao reordenar questões.");
        }
    };

    const handleAddQuestionToSection = async (sectionId: string) => {
        try {
            const section = sections.find(s => s.id === sectionId);
            const maxOrder = section?.questions.reduce((max, q) => Math.max(max, q.order), 0) ?? 0;
            const nextOrder = maxOrder + 1;

            const created = await createQuestion({
                statement: "Nova Pergunta",
                type: "FREE_TEXT",
                isRequired: false,
                order: nextOrder,
                sectionId: Number(sectionId),
            });

            toast.success("Nova questão adicionada!");
            await reload();
            openQuestion(created.id); // já abre para o admin escrever o enunciado
        } catch (e) {
            toast.error("Erro ao adicionar questão.");
        }
    };

    const handleDeleteQuestion = async (sectionId: string, questionId: string) => {
        const confirmedDelete = await confirmDialog({
            title: "Excluir questão",
            description: "Deseja excluir esta questão?",
            confirmLabel: "Excluir",
            variant: "destructive",
        });

        if (confirmedDelete) {
            try {
                const result = await withRulesConfirm((force) => deleteQuestionApi(Number(questionId), force));
                if (result.cancelled) return;

                setSections(prev => prev.map(s => s.id === sectionId ? {
                    ...s, questions: s.questions.filter(q => q.id !== questionId).map((q, i) => ({ ...q, order: i + 1 }))
                } : s));
                await reloadRules();
                toast.success("Questão excluída com sucesso!");
            } catch (e: any) {
                const backendMsg = e?.message || "";
                toast.error(backendMsg.includes("answers") ? "Não é possível excluir: já foi respondida." : "Erro ao excluir questão.");
            }
        }
    };

    // ================= OPÇÕES =================
    const handleAddOption = async (sectionId: string, questionId: string) => {
        const section = sections.find(s => s.id === sectionId);
        const question = section?.questions.find(q => q.id === questionId);
        const maxOrder = question?.options?.reduce((max, o) => Math.max(max, o.order || 0), 0) ?? 0;
        const nextOrder = maxOrder + 1;

        try {
            const newOpt = await createOptionApi(Number(questionId), `Opção ${nextOrder}`, nextOrder);
            setSections(prev => prev.map(s => s.id === sectionId ? {
                ...s, questions: s.questions.map(q => q.id === questionId ? {
                    ...q, options: [...(q.options || []), { id: String(newOpt.id), text: newOpt.text, order: newOpt.order }]
                } : q)
            } : s));
            toast.success("Opção adicionada!", { id: 'opt-add', duration: 1000 });
        } catch (e) {
            toast.error("Erro ao adicionar opção.");
        }
    }

    const handleBlurOptionText = async (optionId: string, text: string) => {
        try {
            await updateOptionApi(Number(optionId), { text });
            toast.success("Opção salva!", { id: "opt-save", duration: 1000 });
        } catch (e) {
            toast.error("Erro ao salvar opção.");
        }
    }

    const handleUpdateOptionLocal = (sectionId: string, questionId: string, optionId: string, text: string) => {
        setSections(prev => prev.map(s => s.id === sectionId ? {
            ...s, questions: s.questions.map(q => q.id === questionId ? {
                ...q, options: q.options?.map(o => o.id === optionId ? { ...o, text } : o)
            } : q)
        } : s));
    }

    const handleDeleteOption = async (sectionId: string, questionId: string, optionId: string) => {
        const section = sections.find(s => s.id === sectionId);
        const question = section?.questions.find(q => q.id === questionId);

        if (question && question.options && question.options.length <= 1) {
            toast.error("A questão precisa ter pelo menos uma opção.");
            return;
        }

        try {
            const result = await withRulesConfirm((force) => deleteOptionApi(Number(optionId), force));
            if (result.cancelled) return;

            setSections(prev => prev.map(s => s.id === sectionId ? {
                ...s, questions: s.questions.map(q => q.id === questionId ? {
                    ...q, options: q.options?.filter(o => o.id !== optionId)
                } : q)
            } : s));
            await reloadRules();
            toast.success("Opção excluída!");
        } catch (e) {
            toast.error("Erro ao excluir opção.");
        }
    }

    const moveOption = async (sectionId: string, questionId: string, optIndex: number, direction: "up" | "down") => {
        const section = sections.find(s => s.id === sectionId);
        const question = section?.questions.find(q => q.id === questionId);
        if (!question || !question.options) return;

        const targetIndex = direction === "up" ? optIndex - 1 : optIndex + 1;
        if (targetIndex < 0 || targetIndex >= question.options.length) return;

        const updatedOptions = [...question.options];
        const [moved] = updatedOptions.splice(optIndex, 1);
        updatedOptions.splice(targetIndex, 0, moved);

        try {
            for (let i = 0; i < updatedOptions.length; i++) {
                const opt = updatedOptions[i];
                await updateOptionApi(Number(opt.id), { order: i + 1 });
            }
            setSections(prev => prev.map(s => s.id === sectionId ? {
                ...s, questions: s.questions.map(q => q.id === questionId ? {
                    ...q, options: updatedOptions.map((o, i) => ({ ...o, order: i + 1 }))
                } : q)
            } : s));
            toast.success("Ordem atualizada!", { id: "opt-order", duration: 1000 });
        } catch (e) {
            toast.error("Erro ao reordenar opções.");
        }
    }

    // ================= REGRAS DE EXIBIÇÃO =================
    const handleAddRule = async (
        target: { questionId?: string; sectionId?: string },
        action: "SHOW" | "HIDE",
        conditions: { sourceQuestionId: number; operator: RuleOperator; triggerValue: string }[],
    ): Promise<boolean> => {
        try {
            await createRuleApi({
                conditions,
                action,
                targetQuestionId: target.questionId !== undefined ? Number(target.questionId) : undefined,
                targetSectionId: target.sectionId !== undefined ? Number(target.sectionId) : undefined,
            });
            await reloadRules();
            toast.success("Regra de exibição salva!", { id: "rule-save", duration: 1500 });
            return true;
        } catch (e) {
            // A API explica o motivo da recusa (ciclo, ordem, valor inválido...).
            toast.error((e as Error)?.message || "Erro ao salvar a regra.", { duration: 7000 });
            return false;
        }
    };

    const handleDeleteRule = async (ruleId: number) => {
        try {
            await deleteRuleApi(ruleId);
            // Regra com várias condições (E) some inteira: recarrega a lista em vez de tirar só uma linha.
            await reloadRules();
            toast.success("Regra removida.", { id: "rule-del", duration: 1500 });
        } catch {
            toast.error("Erro ao remover a regra.");
        }
    };

    const rulesCtx: RulesContext = {
        sections,
        rules,
        onAddRule: handleAddRule,
        onDeleteRule: handleDeleteRule,
    };

    // ==== PACOTE DE AÇÕES ====
    const qActions: QuestionActions = {
        handleTypeChange,
        handleBlurQuestionField,
        updateLocalQuestionState,
        moveQuestion,
        handleDeleteQuestion
    };

    const optActions: OptionActions = {
        handleAddOption,
        handleBlurOptionText,
        handleUpdateOptionLocal,
        handleDeleteOption,
        moveOption
    };

    if (isLoading) {
        return <LoadingState label="Carregando questões..." shape="sections" />;
    }

    if (sections.length === 0) {
        return (
            <div className="relative overflow-hidden rounded-[26px] border border-dashed border-input bg-muted/40 px-6 py-14 text-center">
                <Contour seed={6} rings={10} cx={0.5} cy={0.5} size={1.2} style={{ opacity: 0.3 }} />
                <div className="relative z-10 flex flex-col items-center gap-3">
                    <div className="grid size-14 place-items-center rounded-2xl bg-white text-[var(--green-deep)] ring-1 ring-border">
                        <FolderPlus className="size-6" />
                    </div>
                    <div>
                        <p className="text-base font-semibold tracking-tight">O questionário está vazio</p>
                        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                            Comece criando uma seção. Dentro dela você adiciona as questões que o pesquisador fará em campo.
                        </p>
                    </div>
                    {!readOnly && (
                        <Button size="sm" onClick={handleAddSection}>
                            <FolderPlus className="mr-1.5 size-4" /> Criar primeira seção
                        </Button>
                    )}
                </div>
            </div>
        );
    }

    const totalQuestions = sections.reduce((sum, sec) => sum + sec.questions.length, 0);
    const requiredQuestions = sections.reduce((sum, sec) => sum + sec.questions.filter((q) => q.required).length, 0);
    const allOpen = totalQuestions > 0 && openQuestionIds.size >= totalQuestions;

    const stats = [
        { n: sections.length, label: sections.length === 1 ? "seção" : "seções" },
        { n: totalQuestions, label: totalQuestions === 1 ? "questão" : "questões" },
        { n: requiredQuestions, label: requiredQuestions === 1 ? "obrigatória" : "obrigatórias" },
        { n: rules.length, label: rules.length === 1 ? "regra de exibição" : "regras de exibição" },
    ];

    return (
        <ReadOnlyProvider value={readOnly}>
        <div className="space-y-4 normal-case">
            <div className="sticky top-2 z-10 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[24px] border border-border bg-white/90 p-3 pl-5 shadow-[0_18px_34px_-24px_rgba(10,20,16,0.5)] backdrop-blur">
                <dl className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-2">
                    {stats.map((st, i) => (
                        <div key={st.label} className={`flex items-baseline gap-1.5 ${i > 0 ? "sm:border-l sm:border-border sm:pl-6" : ""}`}>
                            <dt className="order-2 text-[12.5px] text-muted-foreground">{st.label}</dt>
                            <dd className="order-1 text-[26px] font-light leading-none tracking-tighter tabular-nums"><CountUp value={st.n} /></dd>
                        </div>
                    ))}
                </dl>
                <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={allOpen ? collapseAll : expandAll}>
                        {allOpen
                            ? <><ChevronsDownUp className="mr-1.5 size-4" /> Recolher tudo</>
                            : <><ChevronsUpDown className="mr-1.5 size-4" /> Expandir tudo</>}
                    </Button>
                    {!readOnly && (
                        <Button size="sm" onClick={handleAddSection}>
                            <FolderPlus className="mr-1.5 size-4" /> Adicionar seção
                        </Button>
                    )}
                </div>
            </div>

            {readOnly ? (
                <p className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
                    <Lock className="size-3.5 shrink-0" />
                    {readOnlyMessage ?? 'O questionário está travado e não pode ser editado.'}
                </p>
            ) : (
                <p className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
                    <Info className="size-3.5 shrink-0" />
                    Os campos são salvos ao sair deles. Reordenar e excluir são imediatos.
                </p>
            )}

            {sections.map((section, sIndex) => (
                <SectionCard
                    key={section.id}
                    section={section}
                    sIndex={sIndex}
                    totalSections={sections.length}
                    onBlurTitle={handleBlurSectionTitle}
                    onMove={moveSection}
                    onDelete={handleDeleteSection}
                    onAddQuestion={handleAddQuestionToSection}
                    qActions={qActions}
                    optActions={optActions}
                    rulesCtx={rulesCtx}
                    openQuestionIds={openQuestionIds}
                    onToggleQuestion={toggleQuestion}
                />
            ))}
            <div className="h-100 w-full flex-shrink-0" aria-hidden="true" />
        </div>
        </ReadOnlyProvider>
    );
}
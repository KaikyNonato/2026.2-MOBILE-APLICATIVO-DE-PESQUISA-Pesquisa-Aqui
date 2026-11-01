import { apiFetch } from "./apiFetcher";
import { confirmDialog } from "@/components/ui/confirm-dialog";

export type FrontendQuestionType =
    | "text" | "number" | "date" | "time" | "boolean"
    | "single-choice" | "multiple-choice" | "rating-1-5"
    | "photo" | "multiple-photos" | "location" | "audio";

export type BackendQuestionType =
    | "FREE_TEXT" | "NUMERIC" | "DATE" | "TIME" | "YES_NO"
    | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "SCALE_1_5"
    | "PHOTO" | "MULTIPLE_PHOTOS" | "LOCATION" | "AUDIO";

const TYPE_TO_BACKEND: Record<FrontendQuestionType, BackendQuestionType> = {
    "text": "FREE_TEXT", "number": "NUMERIC", "date": "DATE", "time": "TIME",
    "boolean": "YES_NO", "single-choice": "SINGLE_CHOICE", "multiple-choice": "MULTIPLE_CHOICE",
    "rating-1-5": "SCALE_1_5", "photo": "PHOTO", "multiple-photos": "MULTIPLE_PHOTOS",
    "location": "LOCATION", "audio": "AUDIO",
};

const TYPE_FROM_BACKEND: Record<BackendQuestionType, FrontendQuestionType> = {
    "FREE_TEXT": "text", "NUMERIC": "number", "DATE": "date", "TIME": "time",
    "YES_NO": "boolean", "SINGLE_CHOICE": "single-choice", "MULTIPLE_CHOICE": "multiple-choice",
    "SCALE_1_5": "rating-1-5", "PHOTO": "photo", "MULTIPLE_PHOTOS": "multiple-photos",
    "LOCATION": "location", "AUDIO": "audio",
};

export const toBackendType = (type: FrontendQuestionType): BackendQuestionType => TYPE_TO_BACKEND[type];
export function fromBackendType(type: BackendQuestionType): FrontendQuestionType { return TYPE_FROM_BACKEND[type] ?? "text"; }

export interface Option { id: string; text: string; order: number; }

export interface FormQuestion {
    id: string;
    title: string;
    type: FrontendQuestionType;
    helpText: string;
    required: boolean;
    order: number;
    options: Option[];
    minSelections?: number;
    maxSelections?: number;
    minValue?: number;
    maxValue?: number;
    minDate?: string;
    maxDate?: string;
    maxLength?: number;
    scaleLeftLabel?: string;
    scaleRightLabel?: string;
    maxFiles?: number;
    maxDuration?: number;
}

export interface FormSection {
    id: string;
    title: string;
    order: number;
    questions: FormQuestion[];
}

// === REGRAS DE EXIBIÇÃO ===
// A questão afetada (target) só aparece quando a questão de origem (source)
// recebe a resposta triggerValue. YES_NO: "YES" | "NO"; escolhas: id da opção; escala: "1".."5".
export type RuleOperator = "EQ" | "NEQ" | "GT" | "GTE" | "LT" | "LTE" | "CONTAINS" | "NOT_CONTAINS" | "ANSWERED" | "NOT_ANSWERED";

export interface DisplayRule {
    id: number;
    researchId: number;
    sourceQuestionId: number;
    sourceLabel: string;
    sourceStatement: string;
    operator: RuleOperator | string;
    operatorLabel: string;
    triggerValue: string;
    triggerLabel: string;
    /** SHOW: o alvo só aparece quando a regra é verdadeira. HIDE: o alvo some (pulo). */
    action: "SHOW" | "HIDE" | string;
    /** Condições do mesmo alvo com a mesma groupKey valem juntas (E). null = condição sozinha. */
    groupKey: string | null;
    targetKind: "QUESTION" | "SECTION";
    targetQuestionId: number | null;
    targetSectionId: number | null;
    targetLabel: string;
    targetStatement: string;
}

export interface RuleConditionInput {
    sourceQuestionId: number;
    operator: RuleOperator;
    triggerValue: string;
}

// A API devolve 409 quando a operação mexeria em regras; nada foi alterado ainda.
// Repetir a chamada com force=true confirma e apaga essas regras.
export class RulesConflictError extends Error {
    rules: DisplayRule[];
    constructor(message: string, rules: DisplayRule[]) {
        super(message);
        this.name = "RulesConflictError";
        this.rules = rules;
    }
}

async function throwApiError(response: Response, fallback: string): Promise<never> {
    const body = await response.json().catch(() => null);
    if (response.status === 409 && body?.code === "RULES_CONFLICT") {
        throw new RulesConflictError(body.message, body.rules ?? []);
    }
    const message = Array.isArray(body?.message) ? body.message.join(" ") : body?.message;
    throw new Error(message || fallback);
}

const forceQuery = (force?: boolean) => (force ? "?force=true" : "");

export function describeRulesConflict(error: RulesConflictError): string {
    const lines = error.rules.map(
        (r) => `• ${r.targetLabel}: ${r.action === "HIDE" ? "some" : "só aparece"} se ${r.sourceLabel} ${r.operatorLabel} ${r.triggerLabel}`
    );
    return `${error.message}\n\n${lines.join("\n")}\n\nDeseja continuar?`;
}

/**
 * Executa a ação; se a API avisar que há regras envolvidas, pergunta ao usuário e,
 * confirmando, repete com force=true. Retorna { cancelled: true } se ele desistir.
 */
export async function withRulesConfirm<T>(
    run: (force: boolean) => Promise<T>
): Promise<{ cancelled: false; value: T } | { cancelled: true }> {
    try {
        return { cancelled: false, value: await run(false) };
    } catch (error) {
        if (!(error instanceof RulesConflictError)) throw error;
        const confirmed = await confirmDialog({
            title: "Regras de exibição afetadas",
            description: error.message,
            details: error.rules.map((r) => `${r.targetLabel}: ${r.action === "HIDE" ? "some" : "só aparece"} se ${r.sourceLabel} ${r.operatorLabel} ${r.triggerLabel}`),
            confirmLabel: "Continuar",
            variant: "destructive",
        });
        if (!confirmed) return { cancelled: true };
        return { cancelled: false, value: await run(true) };
    }
}

export const getRulesApi = async (researchId: number): Promise<DisplayRule[]> => {
    const response = await apiFetch(`/question-rule?researchId=${researchId}`, { method: 'GET', credentials: 'include' });
    if (!response.ok) return throwApiError(response, 'Failed to get rules');
    return response.json();
}
export const createRuleApi = async (payload: {
    conditions: RuleConditionInput[]; targetQuestionId?: number; targetSectionId?: number; action?: "SHOW" | "HIDE";
}): Promise<DisplayRule> => {
    const response = await apiFetch(`/question-rule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(payload),
    });
    if (!response.ok) return throwApiError(response, 'Falha ao criar a regra');
    return response.json();
}
export const deleteRuleApi = async (id: number) => {
    const response = await apiFetch(`/question-rule/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) return throwApiError(response, 'Falha ao excluir a regra');
    return response.json();
}

// === SEÇÕES ===
export const getSections = async (researchId: number) => {
    const response = await apiFetch(`/section?researchId=${researchId}`, { method: 'GET', credentials: 'include' });
    if (!response.ok) throw new Error('Failed to get sections');
    return response.json();
}
export const createSection = async (title: string, order: number, researchId: number) => {
    const response = await apiFetch(`/section`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ title, order, researchId }),
    });
    if (!response.ok) throw new Error('Failed to create section');
    return response.json();
}
export const updateSectionApi = async (id: number, payload: { title?: string; order?: number }) => {
    const response = await apiFetch(`/section/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('Failed to update section');
    return response.json();
}
export const deleteSectionApi = async (id: number, force = false) => {
    const response = await apiFetch(`/section/${id}${forceQuery(force)}`, { method: 'DELETE' });
    if (!response.ok) return throwApiError(response, 'Failed to delete section');
    return response.json();
}
// Reordena todas as seções de uma vez (a API valida as regras no resultado final).
export const reorderSectionsApi = async (researchId: number, orderedIds: number[], force = false) => {
    const response = await apiFetch(`/section/reorder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ researchId, orderedIds, force }),
    });
    if (!response.ok) return throwApiError(response, 'Failed to reorder sections');
    return response.json();
}

// === QUESTÕES ===
export const getQuestions = async (sectionId: number) => {
    const response = await apiFetch(`/question?sectionId=${sectionId}`, { method: 'GET', credentials: 'include' });
    if (!response.ok) throw new Error('Failed to get questions');
    return response.json();
}
export const createQuestion = async (payload: any) => {
    const response = await apiFetch(`/question`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Failed to create question');
    return response.json();
}
export const updateQuestionApi = async (id: number, payload: any, force = false) => {
    const response = await apiFetch(`/question/${id}${forceQuery(force)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(payload),
    });
    if (!response.ok) return throwApiError(response, 'Failed to update question');
    return response.json();
}
export const deleteQuestionApi = async (id: number, force = false) => {
    const response = await apiFetch(`/question/${id}${forceQuery(force)}`, { method: 'DELETE' });
    if (!response.ok) return throwApiError(response, 'Failed to delete question');
    return response.json();
}
// Reordena todas as questões de uma seção de uma vez (a API valida as regras no resultado final).
export const reorderQuestionsApi = async (sectionId: number, orderedIds: number[], force = false) => {
    const response = await apiFetch(`/question/reorder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ sectionId, orderedIds, force }),
    });
    if (!response.ok) return throwApiError(response, 'Failed to reorder questions');
    return response.json();
}

// === OPÇÕES ===
export const createOptionApi = async (questionId: number, text: string, order: number) => {
    const response = await apiFetch(`/question/${questionId}/option`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ text, order })
    });
    if (!response.ok) throw new Error('Failed to create option');
    return response.json();
}
export const updateOptionApi = async (id: number, payload: { text?: string; order?: number }) => {
    const response = await apiFetch(`/question/option/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('Failed to update option');
    return response.json();
}
export const deleteOptionApi = async (id: number, force = false) => {
    const response = await apiFetch(`/question/option/${id}${forceQuery(force)}`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) return throwApiError(response, 'Failed to delete option');
    return response.json();
}
export const getOptionsApi = async (questionId: number) => {
    const response = await apiFetch(`/question/${questionId}/options`, { method: 'GET', credentials: 'include' });
    if (!response.ok) return [];
    return response.json();
}

export const loadQuestionnaire = async (researchId: number): Promise<FormSection[]> => {
    // Uma só chamada traz seções, questões e alternativas (antes eram uma por seção e uma por questão).
    const response = await apiFetch(`/section/questionnaire?researchId=${researchId}`, { method: 'GET', credentials: 'include' });
    if (!response.ok) await throwApiError(response, "Erro ao carregar o questionário");
    const sections: any[] = await response.json();

    return [...sections]
        .sort((a, b) => a.order - b.order)
        .map((section) => ({
            id: String(section.id),
            title: section.title,
            order: section.order,
            questions: [...(section.questions ?? [])]
                .sort((a: any, b: any) => a.order - b.order)
                .map((q: any) => ({
                    id: String(q.id),
                    title: q.statement,
                    type: fromBackendType(q.type),
                    helpText: q.helpText ?? "",
                    required: q.isRequired,
                    order: q.order,
                    minSelections: q.minSelections ?? undefined,
                    maxSelections: q.maxSelections ?? undefined,
                    minValue: q.minValue ?? undefined,
                    maxValue: q.maxValue ?? undefined,
                    minDate: q.minDate ?? undefined,
                    maxDate: q.maxDate ?? undefined,
                    maxLength: q.maxLength ?? undefined,
                    scaleLeftLabel: q.scaleLeftLabel ?? undefined,
                    scaleRightLabel: q.scaleRightLabel ?? undefined,
                    maxFiles: q.maxFiles ?? undefined,
                    maxDuration: q.maxDuration ?? undefined,
                    options: [...(q.options ?? [])]
                        .sort((a: any, b: any) => a.order - b.order)
                        .map((o: any) => ({ id: String(o.id), text: o.text, order: o.order })),
                })),
        }));
}

export const saveQuestionnaire = async (researchId: number, sections: FormSection[]): Promise<void> => {
    for (let sIndex = 0; sIndex < sections.length; sIndex++) {
        const sec = sections[sIndex];
        const createdSection = await createSection(sec.title || `Seção ${sIndex + 1}`, sIndex + 1, researchId);

        for (let qIndex = 0; qIndex < sec.questions.length; qIndex++) {
            const q = sec.questions[qIndex];
            const newQ = await createQuestion({
                statement: q.title || "Nova Pergunta",
                type: toBackendType(q.type),
                helpText: q.helpText || undefined,
                isRequired: q.required,
                order: qIndex + 1,
                sectionId: createdSection.id,
                minSelections: q.type === "multiple-choice" ? q.minSelections : undefined,
                maxSelections: q.type === "multiple-choice" ? q.maxSelections : undefined,
                minValue: q.type === "number" ? q.minValue : undefined,
                maxValue: q.type === "number" ? q.maxValue : undefined,
                minDate: q.type === "date" ? q.minDate : undefined,
                maxDate: q.type === "date" ? q.maxDate : undefined,
                maxLength: q.type === "text" ? q.maxLength : undefined,
                scaleLeftLabel: q.type === "rating-1-5" ? q.scaleLeftLabel : undefined,
                scaleRightLabel: q.type === "rating-1-5" ? q.scaleRightLabel : undefined,
                maxFiles: q.type === "multiple-photos" ? q.maxFiles : undefined,
                maxDuration: q.type === "audio" ? q.maxDuration : undefined,
            });

            if (q.options && q.options.length > 0) {
                for (let oIndex = 0; oIndex < q.options.length; oIndex++) {
                    await createOptionApi(newQ.id, q.options[oIndex].text, oIndex + 1);
                }
            }
        }
    }
};
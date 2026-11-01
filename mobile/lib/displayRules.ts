// Regras de exibição no app: decide quais questões o entrevistado vê e o que
// ainda falta responder. As regras vêm no pacote da pesquisa (`displayRules`),
// cadastradas na web: "a questão afetada só aparece quando a questão de origem
// recebe a resposta triggerValue".
//
// Formato do gatilho (triggerValue), igual ao da API:
//   YES_NO                          -> "YES" | "NO"
//   SINGLE_CHOICE / MULTIPLE_CHOICE -> id da opção (como texto)
//   SCALE_1_5                       -> "1" a "5"

export interface PackageOption {
    id: number;
    text: string;
    order: number;
}

// Limites cadastrados na web e entregues no pacote. Todos opcionais: sem limite, sem validação.
// minDate/maxDate chegam como "AAAA-MM-DD".
export interface QuestionValidations {
    isRequired?: boolean;
    // Múltipla escolha: quantas opções o entrevistado pode marcar
    minSelections?: number | null;
    maxSelections?: number | null;
    maxLength?: number | null;
    minValue?: number | null;
    maxValue?: number | null;
    minDate?: string | null;
    maxDate?: string | null;
}

export interface PackageQuestion {
    id: number;
    // Preenchido por orderedQuestions: a seção da questão (usado nas regras de pulo de seção)
    sectionId?: number;
    statement: string;
    type: string;
    isRequired: boolean;
    order: number;
    options: PackageOption[];
    // O pacote manda os limites no objeto `validations` e também nos campos planos (compatibilidade).
    validations?: QuestionValidations;
    minSelections?: number | null;
    maxSelections?: number | null;
    // Escala 1 a 5: rótulos das pontas (1 e 5), cadastrados na web
    scaleLeftLabel?: string | null;
    scaleRightLabel?: string | null;
    maxLength?: number | null;
    minValue?: number | null;
    maxValue?: number | null;
    minDate?: string | null;
    maxDate?: string | null;
    // Várias fotos: quantas fotos a questão aceita. O pacote manda em `recording.maxFiles`
    // (e também no campo plano, por compatibilidade).
    maxFiles?: number | null;
    recording?: { maxFiles?: number | null; maxDuration?: number | null };
}

export interface PackageSection {
    id: number;
    title: string;
    order: number;
    questions: PackageQuestion[];
}

// Uma CONDIÇÃO de uma regra. Campos novos ausentes (pacotes antigos) = EQ, SHOW e sem seção.
//  - alvo: uma questão (targetQuestionId) OU uma seção inteira (targetSectionId, "pulo de seção");
//  - action SHOW: o alvo só aparece se a regra for verdadeira; HIDE: o alvo some se for verdadeira;
//  - condições do mesmo alvo com a mesma groupKey valem juntas (E); grupos diferentes, em alternativa (OU);
//    sem groupKey a condição é um grupo sozinha.
export type RuleOperator = 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'CONTAINS' | 'NOT_CONTAINS' | 'ANSWERED' | 'NOT_ANSWERED';

export interface DisplayRule {
    id: number;
    sourceQuestionId: number;
    operator?: RuleOperator | string;
    triggerValue: string;
    targetQuestionId?: number | null;
    targetSectionId?: number | null;
    action?: 'SHOW' | 'HIDE' | string;
    groupKey?: string | null;
}

export interface ResearchPackage {
    id: number;
    title: string;
    // Pesquisa com gravação: o app exige o consentimento e grava a entrevista inteira
    recordInterview?: boolean;
    sections: PackageSection[];
    displayRules: DisplayRule[];
}

// Resposta como o app a guarda: boolean (Sim/Não), id da opção (ou lista de ids), nota da escala...
export type AnswerValue = string | number | boolean | Array<string | number> | null | undefined;
export type Answers = Record<number, AnswerValue>;

/** Respostas como lista de textos comparáveis com triggerValue. */
function toComparableList(answer: AnswerValue): string[] {
    if (answer === null || answer === undefined) return [];
    const items = Array.isArray(answer) ? answer : [answer];
    return items.map((item) => {
        if (item === true) return 'YES';
        if (item === false) return 'NO';
        const text = String(item).trim();
        if (/^(true|yes)$/i.test(text)) return 'YES';
        if (/^(false|no)$/i.test(text)) return 'NO';
        return text;
    });
}

export function isAnswerEmpty(answer: AnswerValue): boolean {
    if (answer === null || answer === undefined) return true;
    if (typeof answer === 'string') return answer.trim() === '';
    if (Array.isArray(answer)) return answer.length === 0;
    return false; // número e boolean (inclusive 0 e false) contam como resposta
}

/** Questões na ordem do questionário (seção, depois questão). */
export function orderedQuestions(pkg: Pick<ResearchPackage, 'sections'>): PackageQuestion[] {
    return [...pkg.sections]
        .sort((a, b) => a.order - b.order)
        .flatMap((section) => [...section.questions].sort((a, b) => a.order - b.order).map((q) => ({ ...q, sectionId: section.id })));
}

/** A condição é verdadeira para esta resposta? (mesma conta de api/src/question-rule/rule-logic.ts) */
export function evaluateCondition(sourceType: string, operator: string, triggerValue: string, answer: AnswerValue): boolean {
    const values = toComparableList(answer).filter((v) => v !== '');
    const answered = values.length > 0;
    const first = values[0];
    const numeric = (text: string | undefined) => (text === undefined || text.trim() === '' ? NaN : Number(text.replace(',', '.')));
    const trigger = numeric(triggerValue);

    const equals = () => {
        if (!answered) return false;
        if (sourceType === 'NUMERIC') return numeric(first) === trigger;
        if (sourceType === 'FREE_TEXT') return first.toLowerCase() === triggerValue.trim().toLowerCase();
        return values.includes(triggerValue);
    };
    const contains = () => answered && first.toLowerCase().includes(triggerValue.trim().toLowerCase());

    switch (operator) {
        case 'ANSWERED': return answered;
        case 'NOT_ANSWERED': return !answered;
        case 'EQ': return equals();
        case 'NEQ': return answered && !equals();
        case 'GT': return numeric(first) > trigger;
        case 'GTE': return numeric(first) >= trigger;
        case 'LT': return numeric(first) < trigger;
        case 'LTE': return numeric(first) <= trigger;
        case 'CONTAINS': return contains();
        case 'NOT_CONTAINS': return answered && !contains();
        default: return false;
    }
}

/**
 * Ids das questões que o entrevistado vê com as respostas atuais.
 * - Sem regra apontando para ela (nem para a seção dela), a questão sempre aparece.
 * - Regras SHOW: basta UM grupo ser verdadeiro (as condições de um grupo valem juntas, E).
 * - Regras HIDE: se algum grupo for verdadeiro, a questão some (pulo de questão ou de seção).
 * - Origem escondida não dispara nada: o pulo se propaga em cadeia.
 */
export function getVisibleQuestionIds(
    pkg: Pick<ResearchPackage, 'sections'> & { displayRules?: DisplayRule[] },
    answers: Answers,
): Set<number> {
    return getVisibleQuestionIdsInOrder(orderedQuestions(pkg), pkg.displayRules ?? [], answers);
}

/**
 * Mesma regra de getVisibleQuestionIds para uma lista de questões que já está na ordem do
 * questionário (seção, depois questão). Usada no envio, que recebe só a lista de questões.
 * Regras de seção precisam do `sectionId` das questões (orderedQuestions preenche).
 */
export function getVisibleQuestionIdsInOrder(
    questions: PackageQuestion[],
    rules: DisplayRule[],
    answers: Answers,
): Set<number> {
    const visible = new Set<number>();
    const typeOf = new Map(questions.map((q) => [q.id, q.type]));

    // Agrupa as condições de um mesmo alvo: o mesmo groupKey vale em conjunto; sem groupKey, cada uma é um grupo.
    type Target = { show: DisplayRule[][]; hide: DisplayRule[][] };
    const byQuestion = new Map<number, Target>();
    const bySection = new Map<number, Target>();
    const slot = (map: Map<number, Target>, id: number) => {
        let entry = map.get(id);
        if (!entry) map.set(id, (entry = { show: [], hide: [] }));
        return entry;
    };
    const groups = new Map<string, DisplayRule[]>();
    for (const rule of rules) {
        const isSection = rule.targetSectionId !== null && rule.targetSectionId !== undefined;
        const targetId = isSection ? rule.targetSectionId! : rule.targetQuestionId;
        if (targetId === null || targetId === undefined) continue;
        const kind = rule.action === 'HIDE' ? 'hide' : 'show';
        const map = isSection ? bySection : byQuestion;
        const key = `${isSection ? 's' : 'q'}${targetId}|${kind}|${rule.groupKey ?? `#${rule.id}`}`;
        let group = groups.get(key);
        if (!group) {
            group = [];
            groups.set(key, group);
            slot(map, targetId)[kind].push(group);
        }
        group.push(rule);
    }

    const holds = (rule: DisplayRule) =>
        visible.has(rule.sourceQuestionId) &&
        evaluateCondition(
            typeOf.get(rule.sourceQuestionId) ?? '',
            rule.operator ?? 'EQ',
            rule.triggerValue ?? '',
            answers[rule.sourceQuestionId],
        );
    const groupHolds = (group: DisplayRule[]) => group.every(holds);
    const passes = (target: Target | undefined) =>
        !target || ((target.show.length === 0 || target.show.some(groupHolds)) && !target.hide.some(groupHolds));

    for (const question of questions) {
        const shown =
            passes(byQuestion.get(question.id)) &&
            (question.sectionId === undefined || passes(bySection.get(question.sectionId)));
        if (shown) visible.add(question.id);
    }
    return visible;
}

/**
 * Obrigatórias que ainda faltam. Questão escondida por regra NÃO conta como
 * obrigatória, senão o pesquisador ficaria preso pedindo uma resposta que não aparece.
 */
export function getMissingRequiredQuestionIds(
    pkg: Pick<ResearchPackage, 'sections'> & { displayRules?: DisplayRule[] },
    answers: Answers,
): number[] {
    const visible = getVisibleQuestionIds(pkg, answers);
    return orderedQuestions(pkg)
        .filter((q) => visible.has(q.id) && q.isRequired && isAnswerEmpty(answers[q.id]))
        .map((q) => q.id);
}

/** Descarta respostas de questões que ficaram escondidas (ex.: o entrevistado voltou e mudou a origem). */
export function pruneHiddenAnswers(
    pkg: Pick<ResearchPackage, 'sections'> & { displayRules?: DisplayRule[] },
    answers: Answers,
): Answers {
    const visible = getVisibleQuestionIds(pkg, answers);
    const kept: Answers = {};
    for (const [id, value] of Object.entries(answers)) {
        if (visible.has(Number(id))) kept[Number(id)] = value;
    }
    return kept;
}

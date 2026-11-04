// Lógica pura (sem banco) das regras de exibição.
//
// Uma regra diz: "a questão afetada (target) só aparece quando a questão de
// origem (source) recebe a resposta triggerValue". A origem sempre precisa vir
// ANTES da questão afetada na ordem do questionário (seção, depois questão).

export const RULE_SOURCE_TYPES = ['YES_NO', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SCALE_1_5'] as const;

export interface StructQuestion {
  id: number;
  sectionId: number;
  sectionOrder: number;
  order: number;
  statement: string;
  type: string;
  options: { id: number; text: string }[];
}

export interface RuleEdge {
  id: number;
  sourceQuestionId: number;
  targetQuestionId: number;
  triggerValue: string;
  // Campos das regras avançadas. Ausentes (regras antigas) = EQ, SHOW e sem alvo de seção.
  operator?: string;
  action?: string;
  groupKey?: string | null;
  /** Preenchido quando a regra aponta para uma seção inteira (a aresta é uma por questão da seção). */
  targetSectionId?: number | null;
}

export interface NewRuleInput {
  sourceQuestionId: number;
  targetQuestionId: number;
  triggerValue: string;
}

/** Diz se o tipo da questão é de escolha (única ou múltipla). */
const isChoice = (type: string) => type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE';

/** Diz se uma questão desse tipo pode ser a origem de uma regra de exibição. */
export function canBeRuleSource(type: string): boolean {
  return (RULE_SOURCE_TYPES as readonly string[]).includes(type);
}

/** Posição de cada questão na ordem do questionário (0 = primeira). */
export function buildRanking(questions: StructQuestion[]): Map<number, number> {
  const sorted = [...questions].sort(
    (a, b) =>
      a.sectionOrder - b.sectionOrder ||
      a.sectionId - b.sectionId ||
      a.order - b.order ||
      a.id - b.id,
  );
  return new Map(sorted.map((q, index) => [q.id, index]));
}

/** Rótulo curto da questão, no formato "Seção X · QY". */
export function questionLabel(q: StructQuestion): string {
  return `Seção ${q.sectionOrder} · Q${q.order}`;
}

/** Texto legível do valor que dispara a regra (Sim/Não, o texto da alternativa ou o próprio valor). */
export function triggerLabel(q: StructQuestion | undefined, triggerValue: string): string {
  if (!q) return triggerValue;
  if (q.type === 'YES_NO') return triggerValue === 'YES' ? 'Sim' : triggerValue === 'NO' ? 'Não' : triggerValue;
  if (isChoice(q.type)) return q.options.find((o) => String(o.id) === triggerValue)?.text ?? triggerValue;
  return triggerValue;
}

/** Retorna a mensagem de erro, ou null se a resposta é válida para a questão. */
export function validateTrigger(q: StructQuestion, triggerValue: string): string | null {
  if (!canBeRuleSource(q.type)) {
    return `A questão de origem (${questionLabel(q)}) não pode disparar regras. Só questões de Sim/Não, Escolha Única, Múltipla Escolha ou Escala de 1 a 5 podem.`;
  }
  const invalid = `A resposta escolhida não é válida para a questão de origem (${questionLabel(q)}).`;
  if (q.type === 'YES_NO') return triggerValue === 'YES' || triggerValue === 'NO' ? null : invalid;
  if (q.type === 'SCALE_1_5') return ['1', '2', '3', '4', '5'].includes(triggerValue) ? null : invalid;
  return q.options.some((o) => String(o.id) === triggerValue) ? null : invalid;
}

/** Caminho from -> ... -> to seguindo as regras (origem -> afetada), ou null. */
export function findPath(edges: RuleEdge[], from: number, to: number): number[] | null {
  const next = new Map<number, number[]>();
  for (const e of edges) {
    next.set(e.sourceQuestionId, [...(next.get(e.sourceQuestionId) ?? []), e.targetQuestionId]);
  }
  const previous = new Map<number, number>();
  const visited = new Set<number>([from]);
  const queue = [from];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) {
      const path = [to];
      while (path[0] !== from) path.unshift(previous.get(path[0])!);
      return path;
    }
    for (const n of next.get(current) ?? []) {
      if (visited.has(n)) continue;
      visited.add(n);
      previous.set(n, current);
      queue.push(n);
    }
  }
  return null;
}

/**
 * Valida uma regra nova. Retorna a mensagem de recusa, ou null se pode salvar.
 * Ordem das checagens: ela mesma, tipo/resposta, duplicada, ciclo, ordem.
 */
export function checkNewRule(
  questions: StructQuestion[],
  edges: RuleEdge[],
  input: NewRuleInput,
): string | null {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const source = byId.get(input.sourceQuestionId);
  const target = byId.get(input.targetQuestionId);
  if (!source || !target) return 'As duas questões da regra precisam pertencer à mesma pesquisa.';

  if (source.id === target.id) return 'Uma questão não pode depender dela mesma.';

  const triggerError = validateTrigger(source, input.triggerValue);
  if (triggerError) return triggerError;

  const duplicated = edges.some(
    (e) =>
      e.sourceQuestionId === source.id &&
      e.targetQuestionId === target.id &&
      e.triggerValue === input.triggerValue,
  );
  if (duplicated) return 'Essa regra já está cadastrada.';

  // Ciclo: a regra nova source -> target fecha um ciclo se já existe target -> ... -> source.
  const back = findPath(edges, target.id, source.id);
  if (back) {
    const labels = [source.id, ...back].map((id) => questionLabel(byId.get(id)!));
    return `A regra cria um ciclo de dependência (${labels.join(' → ')}). Uma questão não pode depender, direta ou indiretamente, dela mesma.`;
  }

  const rank = buildRanking(questions);
  if (rank.get(source.id)! >= rank.get(target.id)!) {
    return `A questão afetada (${questionLabel(target)}) vem antes da questão de origem (${questionLabel(source)}). Uma regra só pode afetar questões que vêm depois da questão de origem.`;
  }

  return null;
}

/** Regras cuja origem não vem mais antes da questão afetada. */
export function findOutOfOrderRules(questions: StructQuestion[], edges: RuleEdge[]): RuleEdge[] {
  const rank = buildRanking(questions);
  return edges.filter((e) => {
    const s = rank.get(e.sourceQuestionId);
    const t = rank.get(e.targetQuestionId);
    return s === undefined || t === undefined || s >= t;
  });
}

/** Regras da questão (como origem) cuja resposta deixou de ser válida para ela. */
export function findRulesWithInvalidTrigger(question: StructQuestion, edges: RuleEdge[]): RuleEdge[] {
  return edges.filter(
    (e) => e.sourceQuestionId === question.id && validateCondition(question, e.operator ?? 'EQ', e.triggerValue) !== null,
  );
}

// =====================================================================================================
// Regras avançadas: operadores, grupos E/OU, pulo de seção.
//
// Uma regra tem uma ou mais CONDIÇÕES (questão de origem + operador + valor) sobre um alvo (questão ou seção
// inteira) e uma AÇÃO: SHOW (o alvo só aparece se a regra for verdadeira) ou HIDE (o alvo some se for verdadeira).
//  - condições com a mesma groupKey, no mesmo alvo, valem em conjunto (E);
//  - grupos diferentes valem em alternativa (OU); condição sem groupKey é um grupo sozinha (regras antigas);
//  - visível = (não há grupo SHOW || algum grupo SHOW é verdadeiro) && !(algum grupo HIDE é verdadeiro);
//  - condição só é verdadeira se a questão de origem está visível (o pulo se propaga em cadeia).
// O aplicativo implementa a mesma conta em mobile/lib/displayRules.ts.
// =====================================================================================================

export const OPERATORS = ['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'CONTAINS', 'NOT_CONTAINS', 'ANSWERED', 'NOT_ANSWERED'] as const;
export type RuleOperator = (typeof OPERATORS)[number];
export const RULE_ACTIONS = ['SHOW', 'HIDE'] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  EQ: 'é igual a',
  NEQ: 'é diferente de',
  GT: 'é maior que',
  GTE: 'é maior ou igual a',
  LT: 'é menor que',
  LTE: 'é menor ou igual a',
  CONTAINS: 'contém',
  NOT_CONTAINS: 'não contém',
  ANSWERED: 'foi respondida',
  NOT_ANSWERED: 'não foi respondida',
};

/** Diz se o valor é um operador de regra válido. */
export const isOperator = (value: unknown): value is RuleOperator =>
  typeof value === 'string' && (OPERATORS as readonly string[]).includes(value);

const NUMERIC_COMPARABLE = ['NUMERIC', 'SCALE_1_5'];
const EQUALITY_TYPES = ['YES_NO', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SCALE_1_5', 'NUMERIC', 'FREE_TEXT'];

/** Operadores que fazem sentido para o tipo da questão de origem. */
export function operatorsFor(type: string): RuleOperator[] {
  const list: RuleOperator[] = [];
  if (EQUALITY_TYPES.includes(type)) list.push('EQ', 'NEQ');
  if (NUMERIC_COMPARABLE.includes(type)) list.push('GT', 'GTE', 'LT', 'LTE');
  if (type === 'FREE_TEXT') list.push('CONTAINS', 'NOT_CONTAINS');
  list.push('ANSWERED', 'NOT_ANSWERED');
  return list;
}

/** Diz se o operador precisa de um valor (todos precisam, menos "respondida" e "não respondida"). */
export const needsValue = (operator: string) => operator !== 'ANSWERED' && operator !== 'NOT_ANSWERED';

export interface Condition {
  sourceQuestionId: number;
  operator: string;
  triggerValue: string;
}

/** Mensagem de erro, ou null se a condição é válida para a questão de origem. */
export function validateCondition(q: StructQuestion, operator: string, triggerValue: string): string | null {
  if (!isOperator(operator)) return `Operador desconhecido: ${operator}.`;
  if (!operatorsFor(q.type).includes(operator)) {
    return `O operador "${OPERATOR_LABELS[operator]}" não se aplica à questão de origem (${questionLabel(q)}).`;
  }
  if (!needsValue(operator)) return null;

  const invalid = `O valor escolhido não é válido para a questão de origem (${questionLabel(q)}).`;
  if (operator === 'EQ' || operator === 'NEQ') {
    if (canBeRuleSource(q.type)) return validateTrigger(q, triggerValue);
    if (q.type === 'NUMERIC') return Number.isFinite(Number(triggerValue)) && triggerValue.trim() !== '' ? null : invalid;
    return triggerValue.trim() !== '' ? null : invalid;
  }
  if (NUMERIC_COMPARABLE.includes(q.type) && ['GT', 'GTE', 'LT', 'LTE'].includes(operator)) {
    return Number.isFinite(Number(triggerValue)) && triggerValue.trim() !== '' ? null : invalid;
  }
  return triggerValue.trim() !== '' ? null : invalid; // CONTAINS / NOT_CONTAINS
}

/** Resposta guardada (texto cru, lista JSON ou valor do app) como lista de textos comparáveis com o gatilho. */
export function normalizeAnswer(answer: unknown): string[] {
  if (answer === null || answer === undefined) return [];
  let items: unknown[];
  if (Array.isArray(answer)) items = answer;
  else if (typeof answer === 'string' && answer.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(answer);
      items = Array.isArray(parsed) ? parsed : [answer];
    } catch {
      items = [answer];
    }
  } else items = [answer];

  return items
    .map((item) => {
      if (item === true) return 'YES';
      if (item === false) return 'NO';
      const text = String(item).trim();
      if (/^(true|yes)$/i.test(text)) return 'YES';
      if (/^(false|no)$/i.test(text)) return 'NO';
      return text;
    })
    .filter((text) => text !== '');
}

/** A condição é verdadeira para esta resposta? (a visibilidade da origem é conferida por quem chama) */
export function evaluateCondition(sourceType: string, operator: string, triggerValue: string, answer: unknown): boolean {
  const values = normalizeAnswer(answer);
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

export interface NewRuleGroupInput {
  targetQuestionId?: number;
  targetSectionId?: number;
  action: RuleAction;
  conditions: Condition[];
}

/** Valida uma regra nova (uma ou mais condições, alvo questão ou seção). Retorna a mensagem de recusa, ou null. */
export function checkNewRuleGroup(
  questions: StructQuestion[],
  edges: RuleEdge[],
  input: NewRuleGroupInput,
): string | null {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const hasQuestion = input.targetQuestionId !== undefined;
  const hasSection = input.targetSectionId !== undefined;
  if (hasQuestion === hasSection) return 'Informe uma questão ou uma seção como alvo da regra (apenas um dos dois).';
  if (input.conditions.length === 0) return 'A regra precisa de pelo menos uma condição.';

  const targets = hasQuestion
    ? questions.filter((q) => q.id === input.targetQuestionId)
    : questions.filter((q) => q.sectionId === input.targetSectionId);
  if (targets.length === 0) {
    return hasQuestion
      ? 'As duas questões da regra precisam pertencer à mesma pesquisa.'
      : 'A seção da regra não existe nesta pesquisa ou não tem questões.';
  }

  const rank = buildRanking(questions);
  const firstTargetRank = Math.min(...targets.map((t) => rank.get(t.id)!));
  const seen = new Set<string>();

  for (const condition of input.conditions) {
    const source = byId.get(condition.sourceQuestionId);
    if (!source) return 'As duas questões da regra precisam pertencer à mesma pesquisa.';

    if (targets.some((t) => t.id === source.id)) {
      return hasQuestion ? 'Uma questão não pode depender dela mesma.' : 'A questão de origem não pode estar dentro da própria seção afetada.';
    }

    const conditionError = validateCondition(source, condition.operator, condition.triggerValue);
    if (conditionError) return conditionError;

    const key = `${source.id}|${condition.operator}|${condition.triggerValue}`;
    if (seen.has(key)) return 'A mesma condição foi repetida na regra.';
    seen.add(key);

    const duplicated = edges.some(
      (e) =>
        e.sourceQuestionId === source.id &&
        (e.operator ?? 'EQ') === condition.operator &&
        e.triggerValue === condition.triggerValue &&
        (e.action ?? 'SHOW') === input.action &&
        (hasQuestion ? e.targetQuestionId === input.targetQuestionId && !e.targetSectionId : e.targetSectionId === input.targetSectionId) &&
        // uma condição repetida só é duplicata de uma regra de uma condição só (num grupo ela faz parte de outra combinação)
        !e.groupKey && input.conditions.length === 1,
    );
    if (duplicated) return 'Essa regra já está cadastrada.';

    for (const target of targets) {
      const back = findPath(edges, target.id, source.id);
      if (back) {
        const labels = [source.id, ...back].map((id) => questionLabel(byId.get(id)!));
        return `A regra cria um ciclo de dependência (${labels.join(' → ')}). Uma questão não pode depender, direta ou indiretamente, dela mesma.`;
      }
    }

    if (rank.get(source.id)! >= firstTargetRank) {
      const first = targets.find((t) => rank.get(t.id) === firstTargetRank)!;
      return hasQuestion
        ? `A questão afetada (${questionLabel(first)}) vem antes da questão de origem (${questionLabel(source)}). Uma regra só pode afetar questões que vêm depois da questão de origem.`
        : `A seção afetada começa antes da questão de origem (${questionLabel(source)}). Uma regra só pode afetar questões que vêm depois da questão de origem.`;
    }
  }

  return null;
}

/** Texto curto de uma condição, para mensagens e telas. */
export function conditionText(source: StructQuestion | undefined, operator: string, triggerValue: string): string {
  const op = isOperator(operator) ? OPERATOR_LABELS[operator] : operator;
  return needsValue(operator) ? `${op} ${triggerLabel(source, triggerValue)}` : op;
}

import {
  checkNewRuleGroup,
  evaluateCondition,
  findRulesWithInvalidTrigger,
  operatorsFor,
  validateCondition,
  type RuleEdge,
  type StructQuestion,
} from './rule-logic';

const q = (id: number, section: number, order: number, type: string, options: { id: number; text: string }[] = []): StructQuestion => ({
  id, sectionId: section * 10, sectionOrder: section, order, statement: `Q${id}`, type, options,
});

// Seção 1: Q1 número, Q2 texto, Q3 múltipla escolha | Seção 2: Q4, Q5 | Seção 3: Q6
const questions = [
  q(1, 1, 1, 'NUMERIC'),
  q(2, 1, 2, 'FREE_TEXT'),
  q(3, 1, 3, 'MULTIPLE_CHOICE', [{ id: 31, text: 'A' }, { id: 32, text: 'B' }]),
  q(4, 2, 1, 'YES_NO'),
  q(5, 2, 2, 'FREE_TEXT'),
  q(6, 3, 1, 'FREE_TEXT'),
];

describe('evaluateCondition', () => {
  it('compara números (maior, menor, igual) com vírgula ou ponto', () => {
    expect(evaluateCondition('NUMERIC', 'GT', '10', '12')).toBe(true);
    expect(evaluateCondition('NUMERIC', 'GT', '10', '10')).toBe(false);
    expect(evaluateCondition('NUMERIC', 'GTE', '10', '10')).toBe(true);
    expect(evaluateCondition('NUMERIC', 'LT', '10', '9,5')).toBe(true);
    expect(evaluateCondition('NUMERIC', 'LTE', '10', '10.0')).toBe(true);
    expect(evaluateCondition('NUMERIC', 'EQ', '3', '3.0')).toBe(true);
  });

  it('sem resposta, comparações são falsas e NOT_ANSWERED é verdadeira', () => {
    for (const op of ['GT', 'GTE', 'LT', 'LTE', 'EQ', 'NEQ', 'CONTAINS', 'NOT_CONTAINS', 'ANSWERED']) {
      expect(evaluateCondition('NUMERIC', op, '1', undefined)).toBe(false);
    }
    expect(evaluateCondition('NUMERIC', 'NOT_ANSWERED', '', '')).toBe(true);
  });

  it('texto: contém ignora maiúsculas; igual e diferente', () => {
    expect(evaluateCondition('FREE_TEXT', 'CONTAINS', 'dor', 'Sinto DOR forte')).toBe(true);
    expect(evaluateCondition('FREE_TEXT', 'NOT_CONTAINS', 'dor', 'tudo bem')).toBe(true);
    expect(evaluateCondition('FREE_TEXT', 'EQ', 'sim', ' Sim ')).toBe(true);
    expect(evaluateCondition('FREE_TEXT', 'NEQ', 'sim', 'não')).toBe(true);
  });

  it('múltipla escolha: igual = marcou a opção; diferente = respondeu e não marcou', () => {
    expect(evaluateCondition('MULTIPLE_CHOICE', 'EQ', '31', '["31","32"]')).toBe(true);
    expect(evaluateCondition('MULTIPLE_CHOICE', 'NEQ', '31', '["32"]')).toBe(true);
    expect(evaluateCondition('MULTIPLE_CHOICE', 'NEQ', '31', '["31"]')).toBe(false);
  });

  it('sim/não aceita true/false do aplicativo', () => {
    expect(evaluateCondition('YES_NO', 'EQ', 'YES', true)).toBe(true);
    expect(evaluateCondition('YES_NO', 'EQ', 'NO', 'false')).toBe(true);
    expect(evaluateCondition('YES_NO', 'NEQ', 'YES', false)).toBe(true);
  });
});

describe('validateCondition', () => {
  it('só oferece comparações numéricas para número e escala', () => {
    expect(operatorsFor('NUMERIC')).toContain('GT');
    expect(operatorsFor('SCALE_1_5')).toContain('LTE');
    expect(operatorsFor('FREE_TEXT')).not.toContain('GT');
    expect(operatorsFor('FREE_TEXT')).toContain('CONTAINS');
    expect(operatorsFor('PHOTO')).toEqual(['ANSWERED', 'NOT_ANSWERED']);
  });

  it('recusa operador que não serve para o tipo e valor inválido', () => {
    expect(validateCondition(questions[1], 'GT', '3')).not.toBeNull();
    expect(validateCondition(questions[0], 'GT', 'abc')).not.toBeNull();
    expect(validateCondition(questions[0], 'GT', '3')).toBeNull();
    expect(validateCondition(questions[1], 'CONTAINS', '  ')).not.toBeNull();
    expect(validateCondition(questions[3], 'EQ', 'TALVEZ')).not.toBeNull();
    expect(validateCondition(questions[4], 'ANSWERED', '')).toBeNull();
    expect(validateCondition(questions[0], 'XYZ', '1')).not.toBeNull();
  });
});

describe('checkNewRuleGroup', () => {
  const base = { action: 'SHOW' as const };

  it('aceita regra com várias condições (E) de questões diferentes', () => {
    const error = checkNewRuleGroup(questions, [], {
      ...base,
      targetQuestionId: 5,
      conditions: [
        { sourceQuestionId: 1, operator: 'GTE', triggerValue: '18' },
        { sourceQuestionId: 4, operator: 'EQ', triggerValue: 'YES' },
      ],
    });
    expect(error).toBeNull();
  });

  it('exige exatamente um alvo e ao menos uma condição', () => {
    expect(checkNewRuleGroup(questions, [], { ...base, conditions: [{ sourceQuestionId: 1, operator: 'GT', triggerValue: '1' }] })).not.toBeNull();
    expect(checkNewRuleGroup(questions, [], { ...base, targetQuestionId: 5, targetSectionId: 30, conditions: [{ sourceQuestionId: 1, operator: 'GT', triggerValue: '1' }] })).not.toBeNull();
    expect(checkNewRuleGroup(questions, [], { ...base, targetQuestionId: 5, conditions: [] })).not.toBeNull();
  });

  it('pulo de seção: a origem precisa vir antes da seção inteira', () => {
    const ok = checkNewRuleGroup(questions, [], { action: 'HIDE', targetSectionId: 20, conditions: [{ sourceQuestionId: 1, operator: 'LT', triggerValue: '18' }] });
    expect(ok).toBeNull();

    const insideSection = checkNewRuleGroup(questions, [], { action: 'HIDE', targetSectionId: 20, conditions: [{ sourceQuestionId: 4, operator: 'EQ', triggerValue: 'NO' }] });
    expect(insideSection).toMatch(/própria seção/);

    const backwards = checkNewRuleGroup(questions, [], { action: 'HIDE', targetSectionId: 10, conditions: [{ sourceQuestionId: 4, operator: 'EQ', triggerValue: 'NO' }] });
    expect(backwards).not.toBeNull();
  });

  it('detecta ciclo passando por regra de seção', () => {
    // Seção 2 (Q4, Q5) escondida por Q1; agora Q1 não pode depender de Q5.
    const edges: RuleEdge[] = [
      { id: 1, sourceQuestionId: 1, targetQuestionId: 4, triggerValue: '18', operator: 'LT', action: 'HIDE', targetSectionId: 20 },
      { id: 1, sourceQuestionId: 1, targetQuestionId: 5, triggerValue: '18', operator: 'LT', action: 'HIDE', targetSectionId: 20 },
    ];
    const error = checkNewRuleGroup(questions, edges, { ...base, targetQuestionId: 1, conditions: [{ sourceQuestionId: 5, operator: 'ANSWERED', triggerValue: '' }] });
    expect(error).not.toBeNull();
  });

  it('recusa condição repetida na mesma regra e regra simples duplicada', () => {
    const repeated = checkNewRuleGroup(questions, [], {
      ...base, targetQuestionId: 5,
      conditions: [{ sourceQuestionId: 1, operator: 'GT', triggerValue: '1' }, { sourceQuestionId: 1, operator: 'GT', triggerValue: '1' }],
    });
    expect(repeated).toMatch(/repetida/);

    const edges: RuleEdge[] = [{ id: 1, sourceQuestionId: 1, targetQuestionId: 5, triggerValue: '1', operator: 'GT', action: 'SHOW' }];
    expect(checkNewRuleGroup(questions, edges, { ...base, targetQuestionId: 5, conditions: [{ sourceQuestionId: 1, operator: 'GT', triggerValue: '1' }] })).toMatch(/já está cadastrada/);
  });
});

describe('troca de tipo com operadores novos', () => {
  it('invalida regra "maior que" quando a origem deixa de ser numérica', () => {
    const edges: RuleEdge[] = [{ id: 7, sourceQuestionId: 1, targetQuestionId: 5, triggerValue: '10', operator: 'GT' }];
    expect(findRulesWithInvalidTrigger({ ...questions[0], type: 'FREE_TEXT' }, edges).map((e) => e.id)).toEqual([7]);
    expect(findRulesWithInvalidTrigger({ ...questions[0], type: 'SCALE_1_5' }, edges)).toEqual([]);
  });
});

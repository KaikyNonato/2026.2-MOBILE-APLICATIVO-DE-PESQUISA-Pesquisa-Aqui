import { checkNewRuleGroup, type RuleEdge, type StructQuestion } from '../question-rule/rule-logic';
import { TEMPLATES } from './research-templates';

const CHOICE = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'];

describe('modelos prontos', () => {
  it('tem ids únicos e conteúdo', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) {
      expect(t.sections.length).toBeGreaterThan(0);
      expect(t.name).toBeTruthy();
    }
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s: estrutura e regras válidas', (_id, t) => {
    const keys = new Set<string>();
    const structs: StructQuestion[] = [];
    t.sections.forEach((section, si) =>
      section.questions.forEach((question, qi) => {
        expect(keys.has(question.key)).toBe(false);
        keys.add(question.key);
        if (CHOICE.includes(question.type)) expect((question.options ?? []).length).toBeGreaterThanOrEqual(2);
        structs.push({
          id: structs.length + 1, sectionId: (si + 1) * 10, sectionOrder: si + 1, order: qi + 1,
          statement: question.statement, type: question.type,
          options: (question.options ?? []).map((text, oi) => ({ id: (structs.length + 1) * 100 + oi, text })),
        });
      }),
    );
    const idOf = (key: string) => structs[[...keys].indexOf(key)].id;

    // As regras entram uma a uma, como o administrador faria na tela: todas precisam ser aceitas.
    const edges: RuleEdge[] = [];
    t.rules.forEach((rule, ri) => {
      const conditions = rule.conditions.map((c) => {
        const source = structs.find((s) => s.id === idOf(c.sourceKey))!;
        const optionId = c.optionIndex !== undefined ? source.options[c.optionIndex]?.id : undefined;
        if (c.optionIndex !== undefined) expect(optionId).toBeDefined();
        return { sourceQuestionId: source.id, operator: c.operator ?? 'EQ', triggerValue: optionId !== undefined ? String(optionId) : (c.value ?? '') };
      });
      const input = {
        targetQuestionId: rule.targetKey ? idOf(rule.targetKey) : undefined,
        targetSectionId: rule.targetSectionIndex !== undefined ? (rule.targetSectionIndex + 1) * 10 : undefined,
        action: rule.action ?? ('SHOW' as const),
        conditions,
      };
      expect(checkNewRuleGroup(structs, edges, input)).toBeNull();

      const targets = input.targetQuestionId ? [input.targetQuestionId] : structs.filter((s) => s.sectionId === input.targetSectionId).map((s) => s.id);
      for (const c of conditions) for (const target of targets) {
        edges.push({ id: ri + 1, sourceQuestionId: c.sourceQuestionId, targetQuestionId: target, triggerValue: c.triggerValue, operator: c.operator, action: input.action, groupKey: conditions.length > 1 ? `g${ri}` : null, targetSectionId: input.targetSectionId ?? null });
      }
    });
  });
});

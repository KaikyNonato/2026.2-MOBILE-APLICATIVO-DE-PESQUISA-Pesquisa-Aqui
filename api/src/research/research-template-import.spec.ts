import { BadRequestException } from '@nestjs/common';
import { sanitizeSpec } from './research-template-spec';
import { TEMPLATES } from './research-templates';

describe('importação de modelos personalizados (sanitizeSpec)', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('aceita o modelo pronto %s (ida e volta do JSON)', (_id, t) => {
    const roundTrip = JSON.parse(JSON.stringify({ sections: t.sections, rules: t.rules }));
    const spec = sanitizeSpec(roundTrip);
    expect(spec.sections).toHaveLength(t.sections.length);
    expect(spec.rules).toHaveLength(t.rules.length);
  });

  const base = () => ({ sections: [{ title: 'S', questions: [{ key: 'a', statement: 'Q?', type: 'YES_NO' }] }], rules: [] as unknown[] });

  it('descarta campos desconhecidos', () => {
    const raw = base() as any;
    raw.sections[0].questions[0].evil = 'x';
    expect((sanitizeSpec(raw).sections[0].questions[0] as any).evil).toBeUndefined();
  });

  it.each([
    ['sem seções', { rules: [] }],
    ['tipo inexistente', { sections: [{ title: 'S', questions: [{ key: 'a', statement: 'Q', type: 'NOPE' }] }] }],
    ['escolha sem opções', { sections: [{ title: 'S', questions: [{ key: 'a', statement: 'Q', type: 'SINGLE_CHOICE', options: ['só uma'] }] }] }],
    ['chave repetida', { sections: [{ title: 'S', questions: [{ key: 'a', statement: 'Q', type: 'YES_NO' }, { key: 'a', statement: 'R', type: 'YES_NO' }] }] }],
    ['regra para questão inexistente', { ...base(), rules: [{ targetKey: 'zzz', conditions: [{ sourceKey: 'a', value: 'YES' }] }] }],
    ['operador inexistente', { ...base(), rules: [{ targetKey: 'a', conditions: [{ sourceKey: 'a', operator: 'XOR' }] }] }],
    ['regra sem alvo', { ...base(), rules: [{ conditions: [{ sourceKey: 'a', value: 'YES' }] }] }],
  ])('rejeita: %s', (_name, raw) => {
    expect(() => sanitizeSpec(raw)).toThrow(BadRequestException);
  });
});

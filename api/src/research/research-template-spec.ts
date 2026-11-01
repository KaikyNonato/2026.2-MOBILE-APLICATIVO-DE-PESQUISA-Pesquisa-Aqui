import { BadRequestException } from '@nestjs/common';
import type { QuestionnaireSpec, SpecQuestion, SpecRule, SpecSection } from './research-templates.js';

const CHOICE = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'];
const QUESTION_TYPES = ['FREE_TEXT', 'NUMERIC', 'DATE', 'TIME', 'YES_NO', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SCALE_1_5', 'PHOTO', 'MULTIPLE_PHOTOS', 'LOCATION', 'AUDIO'];
const OPERATORS = ['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'CONTAINS', 'NOT_CONTAINS', 'ANSWERED', 'NOT_ANSWERED'];
const MAX_SECTIONS = 30;
const MAX_QUESTIONS = 300;
const MAX_OPTIONS = 100;
const MAX_RULES = 300;

const bad = (message: string): never => { throw new BadRequestException(`Modelo inválido: ${message}`); };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number, field: string, required = false): string | undefined => {
    if (v === undefined || v === null || v === '') return required ? bad(`${field} é obrigatório`) : undefined;
    if (typeof v !== 'string') return bad(`${field} deve ser texto`);
    if (v.length > max) return bad(`${field} passa de ${max} caracteres`);
    return v;
};
const num = (v: unknown, field: string): number | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v)) return bad(`${field} deve ser número`);
    return v;
};

/**
 * Valida e normaliza um modelo vindo de fora (arquivo JSON importado). Só campos conhecidos passam,
 * com limites de tamanho; qualquer inconsistência vira 400 com uma mensagem legível.
 */
export function sanitizeSpec(raw: unknown): QuestionnaireSpec {
    if (!isObj(raw) || !Array.isArray(raw.sections)) return bad('faltam as seções');
    if (raw.sections.length === 0) return bad('o modelo precisa de ao menos uma seção');
    if (raw.sections.length > MAX_SECTIONS) return bad(`no máximo ${MAX_SECTIONS} seções`);

    const keys = new Set<string>();
    let total = 0;
    const sections: SpecSection[] = raw.sections.map((sec, si) => {
        if (!isObj(sec) || !Array.isArray(sec.questions)) return bad(`a seção ${si + 1} não tem questões`);
        const questions: SpecQuestion[] = sec.questions.map((q, qi) => {
            const where = `seção ${si + 1}, questão ${qi + 1}`;
            if (!isObj(q)) return bad(`${where} está malformada`);
            if (++total > MAX_QUESTIONS) return bad(`no máximo ${MAX_QUESTIONS} questões`);
            const type = text(q.type, 30, `${where}: tipo`, true) as string;
            if (!QUESTION_TYPES.includes(type)) return bad(`${where}: tipo "${type}" não existe`);
            const key = text(q.key, 80, `${where}: chave`, true) as string;
            if (keys.has(key)) return bad(`${where}: chave "${key}" repetida`);
            keys.add(key);
            let options: string[] | undefined;
            if (CHOICE.includes(type)) {
                if (!Array.isArray(q.options) || q.options.length < 2) return bad(`${where}: questões de escolha precisam de ao menos 2 opções`);
                if (q.options.length > MAX_OPTIONS) return bad(`${where}: no máximo ${MAX_OPTIONS} opções`);
                options = q.options.map((o) => text(o, 200, `${where}: opção`, true) as string);
            }
            return {
                key,
                statement: text(q.statement, 500, `${where}: enunciado`, true) as string,
                type,
                helpText: text(q.helpText, 500, `${where}: texto de ajuda`) ?? null,
                isRequired: q.isRequired === true,
                options,
                minSelections: num(q.minSelections, 'minSelections'),
                maxSelections: num(q.maxSelections, 'maxSelections'),
                minValue: num(q.minValue, 'minValue'),
                maxValue: num(q.maxValue, 'maxValue'),
                minDate: text(q.minDate, 40, 'minDate') ?? null,
                maxDate: text(q.maxDate, 40, 'maxDate') ?? null,
                maxLength: num(q.maxLength, 'maxLength'),
                scaleLeftLabel: text(q.scaleLeftLabel, 100, 'scaleLeftLabel') ?? null,
                scaleRightLabel: text(q.scaleRightLabel, 100, 'scaleRightLabel') ?? null,
                maxFiles: num(q.maxFiles, 'maxFiles'),
                maxDuration: num(q.maxDuration, 'maxDuration'),
            };
        });
        return { title: text(sec.title, 200, `seção ${si + 1}: título`, true) as string, questions };
    });

    const rawRules = raw.rules === undefined ? [] : raw.rules;
    if (!Array.isArray(rawRules)) return bad('as regras devem ser uma lista');
    if (rawRules.length > MAX_RULES) return bad(`no máximo ${MAX_RULES} regras`);
    const rules: SpecRule[] = rawRules.map((r, ri) => {
        if (!isObj(r) || !Array.isArray(r.conditions) || r.conditions.length === 0) return bad(`a regra ${ri + 1} não tem condições`);
        const targetKey = text(r.targetKey, 80, `regra ${ri + 1}: alvo`);
        const targetSectionIndex = r.targetSectionIndex === undefined || r.targetSectionIndex === null ? undefined : (r.targetSectionIndex as number);
        if ((targetKey === undefined) === (targetSectionIndex === undefined)) return bad(`a regra ${ri + 1} precisa de um alvo (questão ou seção)`);
        if (targetKey !== undefined && !keys.has(targetKey)) return bad(`a regra ${ri + 1} aponta para uma questão que não existe`);
        if (targetSectionIndex !== undefined && (!Number.isInteger(targetSectionIndex) || targetSectionIndex < 0 || targetSectionIndex >= sections.length)) return bad(`a regra ${ri + 1} aponta para uma seção que não existe`);
        return {
            targetKey,
            targetSectionIndex,
            action: r.action === 'HIDE' ? 'HIDE' : 'SHOW',
            conditions: r.conditions.map((c) => {
                if (!isObj(c)) return bad(`a regra ${ri + 1} tem uma condição malformada`);
                const sourceKey = text(c.sourceKey, 80, `regra ${ri + 1}: origem`, true) as string;
                if (!keys.has(sourceKey)) return bad(`a regra ${ri + 1} usa uma questão de origem que não existe`);
                const operator = text(c.operator, 20, `regra ${ri + 1}: operador`) ?? 'EQ';
                if (!OPERATORS.includes(operator)) return bad(`a regra ${ri + 1} usa o operador "${operator}", que não existe`);
                const optionIndex = c.optionIndex === undefined || c.optionIndex === null ? undefined : (c.optionIndex as number);
                if (optionIndex !== undefined && (!Number.isInteger(optionIndex) || optionIndex < 0)) return bad(`a regra ${ri + 1} tem uma opção inválida`);
                return { sourceKey, operator, value: text(c.value, 500, `regra ${ri + 1}: valor`), optionIndex };
            }),
        };
    });

    return { sections, rules };
}

import { ConflictException, Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service.js';
import { ResearchService } from '../research/research.service.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { CreateQuestionRuleDto } from './dto/create-question-rule.dto.js';
import {
  checkNewRuleGroup,
  isOperator,
  needsValue,
  OPERATOR_LABELS,
  type RuleAction,
  findOutOfOrderRules,
  findRulesWithInvalidTrigger,
  questionLabel,
  triggerLabel,
  type RuleEdge,
  type StructQuestion,
} from './rule-logic.js';

export interface RuleView {
  id: number;
  researchId: number;
  sourceQuestionId: number;
  sourceLabel: string;
  sourceStatement: string;
  operator: string;
  operatorLabel: string;
  triggerValue: string;
  triggerLabel: string;
  action: string;
  /** Condições com a mesma groupKey (no mesmo alvo) valem em conjunto (E); null = condição sozinha. */
  groupKey: string | null;
  targetKind: 'QUESTION' | 'SECTION';
  targetQuestionId: number | null;
  targetSectionId: number | null;
  targetLabel: string;
  targetStatement: string;
}

interface RuleRow {
  id: number;
  sourceQuestionId: number;
  operator: string;
  triggerValue: string;
  targetQuestionId: number | null;
  targetSectionId: number | null;
  action: string;
  groupKey: string | null;
}

// Mudanças hipotéticas de ordem, para validar ANTES de gravar.
export interface OrderOverrides {
  questionOrders?: Map<number, { order: number; sectionId?: number }>;
  sectionOrders?: Map<number, number>;
}

@Injectable()
export class QuestionRuleService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly researchService: ResearchService,
  ) { }

  private get orm() {
    return this.prisma.client.orm.public;
  }

  // ---------- leitura da estrutura ----------

  /** Todas as questões da pesquisa, já com a ordem das seções, e as regras. */
  private async load(researchId: number, overrides: OrderOverrides = {}) {
    const sections = await this.orm.Section.where({ researchId }).all();
    const sectionOrderOf = new Map<number, number>(
      sections.map((s) => [s.id, overrides.sectionOrders?.get(s.id) ?? s.order]),
    );

    const questions: StructQuestion[] = [];
    await Promise.all(
      sections.map(async (section) => {
        const rows = await this.orm.Question.where({ sectionId: section.id }).all();
        await Promise.all(
          rows.map(async (q) => {
            const isChoice = q.type === 'SINGLE_CHOICE' || q.type === 'MULTIPLE_CHOICE';
            const options = isChoice ? await this.orm.QuestionOption.where({ questionId: q.id }).all() : [];
            const override = overrides.questionOrders?.get(q.id);
            const sectionId = override?.sectionId ?? q.sectionId;
            questions.push({
              id: q.id,
              sectionId,
              sectionOrder: sectionOrderOf.get(sectionId) ?? section.order,
              order: override?.order ?? q.order,
              statement: q.statement,
              type: q.type,
              options: options.map((o) => ({ id: o.id, text: o.text })),
            });
          }),
        );
      }),
    );

    const rows: RuleRow[] = (await this.orm.QuestionRule.where({ researchId }).all()).map((r) => ({
      id: r.id,
      sourceQuestionId: r.sourceQuestionId,
      operator: r.operator ?? 'EQ',
      triggerValue: r.triggerValue,
      targetQuestionId: r.targetQuestionId ?? null,
      targetSectionId: r.targetSectionId ?? null,
      action: r.action ?? 'SHOW',
      groupKey: r.groupKey ?? null,
    }));

    // Para as checagens de ordem e ciclo, uma regra de seção vira uma aresta para cada questão da seção.
    const edges: RuleEdge[] = rows.flatMap((r) => {
      const base = { id: r.id, sourceQuestionId: r.sourceQuestionId, triggerValue: r.triggerValue, operator: r.operator, action: r.action, groupKey: r.groupKey };
      if (r.targetSectionId !== null) {
        return questions
          .filter((q) => q.sectionId === r.targetSectionId)
          .map((q) => ({ ...base, targetQuestionId: q.id, targetSectionId: r.targetSectionId }));
      }
      return r.targetQuestionId !== null ? [{ ...base, targetQuestionId: r.targetQuestionId, targetSectionId: null }] : [];
    });

    const sectionInfo = new Map<number, { order: number; title: string }>(sections.map((s) => [s.id, { order: sectionOrderOf.get(s.id) ?? s.order, title: s.title }]));

    return { questions, edges, rows, sectionInfo };
  }

  private toView(
    researchId: number,
    row: RuleRow,
    questions: StructQuestion[],
    sectionInfo: Map<number, { order: number; title: string }>,
  ): RuleView {
    const source = questions.find((q) => q.id === row.sourceQuestionId);
    const target = row.targetQuestionId !== null ? questions.find((q) => q.id === row.targetQuestionId) : undefined;
    const section = row.targetSectionId !== null ? sectionInfo.get(row.targetSectionId) : undefined;
    const isSection = row.targetSectionId !== null;
    return {
      id: row.id,
      researchId,
      sourceQuestionId: row.sourceQuestionId,
      sourceLabel: source ? questionLabel(source) : `Questão ${row.sourceQuestionId}`,
      sourceStatement: source?.statement ?? '',
      operator: row.operator,
      operatorLabel: isOperator(row.operator) ? OPERATOR_LABELS[row.operator] : row.operator,
      triggerValue: row.triggerValue,
      triggerLabel: needsValue(row.operator) ? triggerLabel(source, row.triggerValue) : '',
      action: row.action,
      groupKey: row.groupKey,
      targetKind: isSection ? 'SECTION' : 'QUESTION',
      targetQuestionId: row.targetQuestionId,
      targetSectionId: row.targetSectionId,
      targetLabel: isSection
        ? (section ? `Seção ${section.order}` : `Seção ${row.targetSectionId}`)
        : target ? questionLabel(target) : `Questão ${row.targetQuestionId}`,
      targetStatement: isSection ? (section?.title ?? '') : (target?.statement ?? ''),
    };
  }

  private conflict(message: string, views: RuleView[]) {
    return new ConflictException({ statusCode: 409, code: 'RULES_CONFLICT', message, rules: views });
  }

  // ---------- CRUD ----------

  async create(dto: CreateQuestionRuleDto, currentUser: UserPayLoad) {
    // Formato antigo (uma condição "é igual a") vira uma lista de uma condição.
    const conditions =
      dto.conditions ??
      (dto.sourceQuestionId !== undefined
        ? [{ sourceQuestionId: dto.sourceQuestionId, operator: dto.operator, triggerValue: dto.triggerValue }]
        : []);
    if (conditions.length === 0) throw new BadRequestException('A regra precisa de pelo menos uma condição.');
    if ((dto.targetQuestionId === undefined) === (dto.targetSectionId === undefined)) {
      throw new BadRequestException('Informe uma questão ou uma seção como alvo da regra (apenas um dos dois).');
    }

    // Pesquisa do alvo; todas as questões de origem precisam ser dela.
    let researchId: number;
    if (dto.targetSectionId !== undefined) {
      const section = await this.orm.Section.where({ id: dto.targetSectionId }).first();
      if (!section) throw new NotFoundException('Section not found');
      researchId = section.researchId;
    } else {
      const target = await this.orm.Question.where({ id: dto.targetQuestionId! }).first();
      if (!target) throw new NotFoundException('Question not found');
      const section = await this.orm.Section.where({ id: target.sectionId }).first();
      if (!section) throw new NotFoundException('Section not found');
      researchId = section.researchId;
    }
    await this.researchService.assertEditable(researchId, currentUser);

    const { questions, edges, sectionInfo } = await this.load(researchId);
    const normalized = conditions.map((c) => ({
      sourceQuestionId: c.sourceQuestionId,
      operator: c.operator ?? 'EQ',
      triggerValue: needsValue(c.operator ?? 'EQ') ? (c.triggerValue ?? '') : '',
    }));
    const action = (dto.action ?? 'SHOW') as RuleAction;

    const error = checkNewRuleGroup(questions, edges, {
      targetQuestionId: dto.targetQuestionId,
      targetSectionId: dto.targetSectionId,
      action,
      conditions: normalized,
    });
    if (error) throw new BadRequestException(error);

    const groupKey = normalized.length > 1 ? randomUUID() : null;
    const created: RuleRow[] = [];
    for (const condition of normalized) {
      const row = await this.orm.QuestionRule.create({
        researchId,
        sourceQuestionId: condition.sourceQuestionId,
        operator: condition.operator,
        triggerValue: condition.triggerValue,
        targetQuestionId: dto.targetQuestionId ?? null,
        targetSectionId: dto.targetSectionId ?? null,
        action,
        groupKey,
      });
      created.push({
        id: row.id,
        sourceQuestionId: condition.sourceQuestionId,
        operator: condition.operator,
        triggerValue: condition.triggerValue,
        targetQuestionId: dto.targetQuestionId ?? null,
        targetSectionId: dto.targetSectionId ?? null,
        action,
        groupKey,
      });
    }

    const views = created.map((row) => this.toView(researchId, row, questions, sectionInfo));
    return { ...views[0], rules: views };
  }

  async findAll(researchId: number, currentUser: UserPayLoad): Promise<RuleView[]> {
    await this.researchService.findOne(researchId, currentUser);
    const { questions, rows, sectionInfo } = await this.load(researchId);
    return rows.map((r) => this.toView(researchId, r, questions, sectionInfo));
  }

  /** Apaga a regra. Se ela faz parte de um grupo de condições (E), apaga o grupo inteiro. */
  async delete(id: number, currentUser: UserPayLoad) {
    const rule = await this.orm.QuestionRule.where({ id }).first();
    if (!rule) throw new NotFoundException('Rule not found');
    await this.researchService.assertEditable(rule.researchId, currentUser);
    if (rule.groupKey) {
      return await this.orm.QuestionRule.where({ researchId: rule.researchId, groupKey: rule.groupKey }).delete();
    }
    return await this.orm.QuestionRule.where({ id }).delete();
  }

  // ---------- proteções usadas por question/section ----------

  /** Linhas (sem repetir) das regras pelos ids, já como RuleView. */
  private viewsOf(
    researchId: number,
    ids: Iterable<number>,
    data: { rows: RuleRow[]; questions: StructQuestion[]; sectionInfo: Map<number, { order: number; title: string }> },
  ): RuleView[] {
    const wanted = new Set(ids);
    return data.rows.filter((r) => wanted.has(r.id)).map((r) => this.toView(researchId, r, data.questions, data.sectionInfo));
  }

  private async deleteRules(ids: Iterable<number>) {
    await Promise.all([...new Set(ids)].map((id) => this.orm.QuestionRule.where({ id }).delete()));
  }

  /**
   * Antes de excluir questões: se alguma participa de regra, avisa (409) e só
   * segue com force. A exclusão da regra em si fica por conta do ON DELETE CASCADE,
   * assim, se a exclusão da questão falhar, a regra continua intacta.
   * (Regras que apontam para a SEÇÃO inteira não são afetadas por excluir uma questão dela.)
   */
  async guardQuestionDeletion(researchId: number, questionIds: number[], force: boolean, subject: string) {
    if (questionIds.length === 0) return;
    const data = await this.load(researchId);
    const ids = new Set(questionIds);
    const affected = new Set(
      data.rows
        .filter((r) => ids.has(r.sourceQuestionId) || (r.targetQuestionId !== null && ids.has(r.targetQuestionId)))
        .map((r) => r.id),
    );
    if (affected.size === 0 || force) return;

    throw this.conflict(
      `${subject} de ${affected.size} regra(s) de exibição. Excluir apaga também essas regras.`,
      this.viewsOf(researchId, affected, data),
    );
  }

  /**
   * Antes de mudar a ordem de questões/seções: se alguma regra passaria a apontar
   * para uma questão anterior, avisa (409). Com force, apaga essas regras.
   */
  async applyOrderChange(researchId: number, overrides: OrderOverrides, force: boolean) {
    const data = await this.load(researchId, overrides);
    const broken = new Set(findOutOfOrderRules(data.questions, data.edges).map((e) => e.id));
    if (broken.size === 0) return;

    if (!force) {
      throw this.conflict(
        `Essa mudança de ordem deixaria ${broken.size} regra(s) de exibição apontando para uma questão anterior. Elas serão apagadas se você continuar.`,
        this.viewsOf(researchId, broken, data),
      );
    }
    await this.deleteRules(broken);
  }

  /** Antes de excluir uma opção: regras que disparam por ela ficariam órfãs. */
  async guardOptionDeletion(researchId: number, questionId: number, optionId: number, force: boolean) {
    const data = await this.load(researchId);
    const affected = new Set(
      data.rows
        .filter((r) => r.sourceQuestionId === questionId && needsValue(r.operator) && r.triggerValue === String(optionId))
        .map((r) => r.id),
    );
    if (affected.size === 0) return;

    if (!force) {
      throw this.conflict(
        `Essa opção dispara ${affected.size} regra(s) de exibição. Excluí-la apaga também essas regras.`,
        this.viewsOf(researchId, affected, data),
      );
    }
    await this.deleteRules(affected);
  }

  /** Antes de trocar o tipo: regras cuja resposta ou operador deixa de fazer sentido. */
  async guardTypeChange(researchId: number, questionId: number, newType: string, force: boolean) {
    const data = await this.load(researchId);
    const current = data.questions.find((q) => q.id === questionId);
    if (!current) return;

    const broken = new Set(findRulesWithInvalidTrigger({ ...current, type: newType }, data.edges).map((e) => e.id));
    if (broken.size === 0) return;

    if (!force) {
      throw this.conflict(
        `Mudar o tipo desta questão invalida ${broken.size} regra(s) de exibição que dependem da resposta dela. Elas serão apagadas se você continuar.`,
        this.viewsOf(researchId, broken, data),
      );
    }
    await this.deleteRules(broken);
  }
}

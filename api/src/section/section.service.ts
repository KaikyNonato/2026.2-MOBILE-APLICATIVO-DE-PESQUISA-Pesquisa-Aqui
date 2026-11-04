import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateSectionDto } from './dto/create-section.dto.js';
import { UpdateSectionDto } from './dto/update-section.dto.js';
import { PrismaService } from '../prisma.service.js';
import { UserPayLoad } from '../auth/current-user.type.js';
import { ResearchService } from '../research/research.service.js';
import { QuestionRuleService } from '../question-rule/question-rule.service.js';
import { ReorderSectionsDto } from './dto/reorder-sections.dto.js';

/** Regras das seções do questionário: criação, listagem, edição, exclusão e reordenação. */
@Injectable()
export class SectionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly researchService: ResearchService,
    private readonly ruleService: QuestionRuleService,
  ) { }

  /** Cria uma seção, se a pesquisa ainda puder ser editada. */
  async create(createSectionDto: CreateSectionDto, currentUser: UserPayLoad) {
    await this.researchService.assertEditable(createSectionDto.researchId, currentUser);

    return await this.prisma.client.orm.public.Section.create({
      title: createSectionDto.title,
      researchId: createSectionDto.researchId,
      order: createSectionDto.order,
    });
  }

  /** Lista as seções de uma pesquisa que o usuário pode ver. */
  async findAll(researchId: number, currentUser: UserPayLoad) {
    await this.researchService.findOne(researchId, currentUser);
    return await this.prisma.client.orm.public.Section.where({ researchId }).all();
  }

  /**
   * Questionário inteiro da pesquisa (seções > questões > alternativas) numa só chamada.
   * Mesma permissão de findAll; são só 3 consultas, qualquer que seja o tamanho do questionário.
   */
  async questionnaire(researchId: number, currentUser: UserPayLoad) {
    await this.researchService.findOne(researchId, currentUser);
    const orm = this.prisma.client.orm.public;

    const sections = [...(await orm.Section.where({ researchId }).all())].sort((a, b) => a.order - b.order);
    if (sections.length === 0) return [];

    const sectionIds = sections.map((section) => section.id);
    const questions = [...(await orm.Question.where((q) => q.sectionId.in(sectionIds)).all())].sort((a, b) => a.order - b.order);
    const questionIds = questions.map((q) => q.id);
    const options = questionIds.length > 0
      ? [...(await orm.QuestionOption.where((o) => o.questionId.in(questionIds)).all())].sort((a, b) => a.order - b.order)
      : [];

    const optionsOf = new Map<number, typeof options>();
    for (const option of options) {
      const list = optionsOf.get(option.questionId);
      if (list) list.push(option);
      else optionsOf.set(option.questionId, [option]);
    }
    const questionsOf = new Map<number, Array<(typeof questions)[number] & { options: typeof options }>>();
    for (const question of questions) {
      const item = { ...question, options: optionsOf.get(question.id) ?? [] };
      const list = questionsOf.get(question.sectionId);
      if (list) list.push(item);
      else questionsOf.set(question.sectionId, [item]);
    }

    return sections.map((section) => ({ ...section, questions: questionsOf.get(section.id) ?? [] }));
  }

  /** Busca uma seção, conferindo se o usuário pode ver a pesquisa dela. Lança 404 se não existir. */
  async findOne(id: number, currentUser: UserPayLoad) {
    const section = await this.prisma.client.orm.public.Section.where({ id }).first();

    if (!section) throw new NotFoundException('Section not found');

    await this.researchService.findOne(section.researchId, currentUser);

    return section;
  }

  /**
   * Edita uma seção. Mudar a ordem confere as regras de exibição; `force` confirma mesmo quando
   * elas são afetadas.
   */
  async update(id: number, updateSectionDto: UpdateSectionDto, currentUser: UserPayLoad, force = false) {
    const section = await this.findOne(id, currentUser);
    await this.researchService.assertEditable(section.researchId, currentUser);

    // Mudar a ordem da seção não pode deixar regra apontando para trás.
    if (updateSectionDto.order !== undefined && updateSectionDto.order !== section.order) {
      await this.ruleService.applyOrderChange(
        section.researchId,
        { sectionOrders: new Map([[id, updateSectionDto.order]]) },
        force,
      );
    }

    return await this.prisma.client.orm.public.Section.where({ id }).update(updateSectionDto);
  }

  /** Reordena todas as seções da pesquisa de uma vez, validando as regras no resultado final. */
  async reorder(dto: ReorderSectionsDto, currentUser: UserPayLoad) {
    await this.researchService.assertEditable(dto.researchId, currentUser);
    const sections = await this.prisma.client.orm.public.Section.where({ researchId: dto.researchId }).all();

    const currentIds = sections.map((s) => s.id).sort((a, b) => a - b);
    const sentIds = [...dto.orderedIds].sort((a, b) => a - b);
    if (currentIds.length !== sentIds.length || currentIds.some((sId, i) => sId !== sentIds[i])) {
      throw new BadRequestException('A lista precisa conter exatamente as seções da pesquisa.');
    }

    await this.ruleService.applyOrderChange(
      dto.researchId,
      { sectionOrders: new Map(dto.orderedIds.map((sId, index) => [sId, index + 1])) },
      dto.force ?? false,
    );

    for (let index = 0; index < dto.orderedIds.length; index++) {
      await this.prisma.client.orm.public.Section.where({ id: dto.orderedIds[index] }).update({ order: index + 1 });
    }
    return { ok: true };
  }

  /**
   * Exclui uma seção e as questões dela. Se alguma participa de regras de exibição, só segue com
   * `force`.
   */
  async delete(id: number, currentUser: UserPayLoad, force = false) {
    const section = await this.findOne(id, currentUser);
    await this.researchService.assertEditable(section.researchId, currentUser);

    const questions = await this.prisma.client.orm.public.Question.where({ sectionId: id }).all();
    const questionIds = questions.map((q) => q.id);

    if (questionIds.length > 0) {
      for (const qId of questionIds) {
        const answers = await this.prisma.client.orm.public.Answer.where({
          questionId: qId,
        }).all();

        if (answers && answers.length > 0) {
          throw new BadRequestException(
            'This section cannot be deleted because it contains questions that already have answers submitted by respondents.'
          );
        }
      }
    }

    // Avisa se alguma questão da seção é usada em regras; as regras saem junto (ON DELETE CASCADE).
    await this.ruleService.guardQuestionDeletion(section.researchId, questionIds, force, 'Questões desta seção participam');

    await this.prisma.client.orm.public.Question.where({ sectionId: id }).delete();

    return await this.prisma.client.orm.public.Section.where({ id }).delete();
  }
}

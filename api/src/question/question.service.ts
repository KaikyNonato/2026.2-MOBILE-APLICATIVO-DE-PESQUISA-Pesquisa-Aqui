import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateQuestionDto } from './dto/create-question.dto.js';
import { UpdateQuestionDto } from './dto/update-question.dto.js';
import { PrismaService } from '../prisma.service.js';
import { UserPayLoad } from '../auth/current-user.type.js';
import { SectionService } from '../section/section.service.js';
import { QuestionRuleService } from '../question-rule/question-rule.service.js';
import { ResearchService } from '../research/research.service.js';
import { ReorderQuestionsDto } from './dto/reorder-questions.dto.js';

/** Regras das questões do questionário e das alternativas de resposta. */
@Injectable()
export class QuestionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly sectionService: SectionService,
    private readonly ruleService: QuestionRuleService,
    private readonly researchService: ResearchService,
  ) { }

  /** Cria uma questão na seção, se a pesquisa ainda puder ser editada. */
  async create(createQuestionDto: CreateQuestionDto, currentUser: UserPayLoad) {
    const section = await this.sectionService.findOne(createQuestionDto.sectionId, currentUser);
    await this.researchService.assertEditable(section.researchId, currentUser);

    return await this.prisma.client.orm.public.Question.create({
      statement: createQuestionDto.statement,
      type: createQuestionDto.type,
      helpText: createQuestionDto.helpText,
      isRequired: createQuestionDto.isRequired,
      order: createQuestionDto.order,
      sectionId: createQuestionDto.sectionId,
      minSelections: createQuestionDto.minSelections,
      maxSelections: createQuestionDto.maxSelections,
      minValue: createQuestionDto.minValue,
      maxValue: createQuestionDto.maxValue,
      minDate: createQuestionDto.minDate,
      maxDate: createQuestionDto.maxDate,
      maxLength: createQuestionDto.maxLength,
      scaleLeftLabel: createQuestionDto.scaleLeftLabel,
      scaleRightLabel: createQuestionDto.scaleRightLabel,
      maxFiles: createQuestionDto.maxFiles,
      maxDuration: createQuestionDto.maxDuration,
    });
  }

  /** Lista as questões de uma seção que o usuário pode ver. */
  async findAll(sectionId: number, currentUser: UserPayLoad) {
    await this.sectionService.findOne(sectionId, currentUser);
    return await this.prisma.client.orm.public.Question.where({ sectionId }).all();
  }

  /** Busca uma questão, conferindo a permissão do usuário. Lança 404 se não existir. */
  async findOne(id: number, currentUser: UserPayLoad) {
    const { question } = await this.findWithSection(id, currentUser);
    return question;
  }

  /** Busca a questão e a seção dela, conferindo a permissão do usuário. */
  private async findWithSection(id: number, currentUser: UserPayLoad) {
    const question = await this.prisma.client.orm.public.Question.where({ id }).first();
    if (!question) throw new NotFoundException('Question not found');
    const section = await this.sectionService.findOne(question.sectionId, currentUser);
    return { question, section };
  }

  /**
   * Edita uma questão. Trocar o tipo confere as regras de exibição; `force` confirma mesmo quando
   * elas são afetadas.
   */
  async update(id: number, updateQuestionDto: UpdateQuestionDto, currentUser: UserPayLoad, force = false) {
    const { question, section } = await this.findWithSection(id, currentUser);
    await this.researchService.assertEditable(section.researchId, currentUser);

    // Trocar o tipo pode invalidar a resposta que dispara regras desta questão.
    if (updateQuestionDto.type !== undefined && updateQuestionDto.type !== question.type) {
      await this.ruleService.guardTypeChange(section.researchId, id, updateQuestionDto.type, force);
    }

    // Mudar a ordem (ou a seção) não pode deixar regra apontando para trás.
    if (updateQuestionDto.order !== undefined || updateQuestionDto.sectionId !== undefined) {
      if (updateQuestionDto.sectionId !== undefined && updateQuestionDto.sectionId !== question.sectionId) {
        const newSection = await this.sectionService.findOne(updateQuestionDto.sectionId, currentUser);
        if (newSection.researchId !== section.researchId) {
          throw new BadRequestException('A questão só pode ser movida para uma seção da mesma pesquisa.');
        }
      }
      await this.ruleService.applyOrderChange(
        section.researchId,
        {
          questionOrders: new Map([[id, {
            order: updateQuestionDto.order ?? question.order,
            sectionId: updateQuestionDto.sectionId,
          }]]),
        },
        force,
      );
    }

    return await this.prisma.client.orm.public.Question.where({ id }).update(updateQuestionDto);
  }

  /** Reordena todas as questões de uma seção de uma vez, validando as regras no resultado final. */
  async reorder(dto: ReorderQuestionsDto, currentUser: UserPayLoad) {
    const section = await this.sectionService.findOne(dto.sectionId, currentUser);
    await this.researchService.assertEditable(section.researchId, currentUser);
    const questions = await this.prisma.client.orm.public.Question.where({ sectionId: dto.sectionId }).all();

    const currentIds = questions.map((q) => q.id).sort((a, b) => a - b);
    const sentIds = [...dto.orderedIds].sort((a, b) => a - b);
    if (currentIds.length !== sentIds.length || currentIds.some((qId, i) => qId !== sentIds[i])) {
      throw new BadRequestException('A lista precisa conter exatamente as questões da seção.');
    }

    await this.ruleService.applyOrderChange(
      section.researchId,
      { questionOrders: new Map(dto.orderedIds.map((qId, index) => [qId, { order: index + 1 }])) },
      dto.force ?? false,
    );

    for (let index = 0; index < dto.orderedIds.length; index++) {
      await this.prisma.client.orm.public.Question.where({ id: dto.orderedIds[index] }).update({ order: index + 1 });
    }
    return { ok: true };
  }

  /**
   * Exclui uma questão. Se ela participa de regras de exibição, só segue com `force` (as regras
   * saem junto).
   */
  async delete(id: number, currentUser: UserPayLoad, force = false) {
    const { section } = await this.findWithSection(id, currentUser);
    await this.researchService.assertEditable(section.researchId, currentUser);

    // Avisa se a questão é usada em regras; as regras saem junto (ON DELETE CASCADE).
    await this.ruleService.guardQuestionDeletion(section.researchId, [id], force, 'Esta questão participa');

    try {
      return await this.prisma.client.orm.public.Question.where({ id }).delete();
    } catch (error: any) {
      if (error?.sqlState === '23503' || error?.code === '23503' || error?.message?.includes('answer_questionId_fkey')) {
        throw new BadRequestException('This question cannot be deleted because it already has answers submitted by respondents.');
      }
      throw error;
    }
  }

  /** --- GERENCIAMENTO DE OPÇÕES DE RESPOSTA --- */
  async createOption(questionId: number, text: string, order: number, currentUser: UserPayLoad) {
    await this.assertQuestionEditable(questionId, currentUser);
    return await this.prisma.client.orm.public.QuestionOption.create({
      questionId,
      text,
      order,
    });
  }

  /** Resolve questão -> seção -> pesquisa e confere acesso + trava. */
  private async assertQuestionEditable(questionId: number, currentUser: UserPayLoad) {
    const { section } = await this.findWithSection(questionId, currentUser);
    await this.researchService.assertEditable(section.researchId, currentUser);
    return section;
  }

  /** Lista as alternativas de resposta de uma questão. */
  async getOptions(questionId: number) {
    return await this.prisma.client.orm.public.QuestionOption.where({ questionId }).all();
  }

  /** Edita o texto e/ou a ordem de uma alternativa, se a pesquisa ainda puder ser editada. */
  async updateOption(id: number, currentUser: UserPayLoad, text?: string, order?: number) {
    const current = await this.prisma.client.orm.public.QuestionOption.where({ id }).first();
    if (!current) throw new NotFoundException('Option not found');
    await this.assertQuestionEditable(current.questionId, currentUser);
    const data: any = {};
    if (text !== undefined) data.text = text;
    if (order !== undefined) data.order = order;
    return await this.prisma.client.orm.public.QuestionOption.where({ id }).update(data);
  }

  /**
   * Exclui uma alternativa, conferindo antes as regras de exibição que dependem dela (`force`
   * confirma).
   */
  async deleteOption(id: number, currentUser: UserPayLoad, force = false) {
    const option = await this.prisma.client.orm.public.QuestionOption.where({ id }).first();
    if (option) {
      await this.assertQuestionEditable(option.questionId, currentUser);
      const question = await this.prisma.client.orm.public.Question.where({ id: option.questionId }).first();
      const section = question
        ? await this.prisma.client.orm.public.Section.where({ id: question.sectionId }).first()
        : null;
      if (question && section) {
        await this.ruleService.guardOptionDeletion(section.researchId, question.id, id, force);
      }
    }
    return await this.prisma.client.orm.public.QuestionOption.where({ id }).delete();
  }
}

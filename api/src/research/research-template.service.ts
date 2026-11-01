import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { ResearchService } from './research.service.js';
import { TEMPLATES, templateSummary, type QuestionnaireSpec, type SpecQuestion, type SpecRule, type SpecSection } from './research-templates.js';
import { sanitizeSpec } from './research-template-spec.js';
import type { CreateFromSpecDto, CreateFromTemplateDto, DuplicateResearchDto } from './dto/research-template.dto.js';

const CHOICE = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pesquisa nova a partir de outra pesquisa (duplicar) ou de um modelo pronto. Só a ESTRUTURA vai junto
 * (seções, questões, opções e regras): coletas, pesquisadores vinculados e cópias em campo nunca são copiados,
 * e a pesquisa nova sempre nasce como rascunho.
 */
@Injectable()
export class ResearchTemplateService {
    constructor(private prisma: PrismaService, private researchService: ResearchService) { }

    private get orm() {
        return this.prisma.client.orm.public;
    }

    listTemplates() {
        return TEMPLATES.map(templateSummary);
    }

    private companyFor(currentUser: UserPayLoad, requested?: number): number {
        if (currentUser.profile === 'RESEARCHER') throw new ForbiddenException('Researchers cannot create research');
        const companyId = currentUser.profile === 'SUPERADMINISTRATOR' ? requested : currentUser.companyId;
        if (!companyId) {
            throw currentUser.profile === 'SUPERADMINISTRATOR'
                ? new BadRequestException('The company ID is required for super administrators')
                : new ForbiddenException('User is not associated with a company');
        }
        return companyId;
    }

    // ---------- duplicar ----------

    async duplicate(id: number, dto: DuplicateResearchDto, currentUser: UserPayLoad) {
        const original = await this.researchService.findOne(id, currentUser);
        const companyId = this.companyFor(currentUser, original.companyId);
        const spec = await this.exportSpec(original.id);

        // Mantém a duração da pesquisa original, começando agora.
        const length = Math.max(DAY_MS, new Date(original.endDate).getTime() - new Date(original.startDate).getTime());
        const now = Date.now();

        const research = await this.prisma.client.transaction(async (tx) => {
            const created = await tx.orm.public.Research.create({
                title: dto.title?.trim() || `${original.title} (cópia)`,
                description: original.description,
                objective: original.objective,
                targetAudience: original.targetAudience,
                startDate: new Date(now).toISOString(),
                endDate: new Date(now + length).toISOString(),
                status: 'DRAFT',
                recordInterview: original.recordInterview,
                areaLatitude: original.areaLatitude ?? null,
                areaLongitude: original.areaLongitude ?? null,
                areaRadiusKm: original.areaRadiusKm ?? null,
                companyId,
            });
            await this.writeSpec(tx.orm.public, created.id, spec);
            return created;
        });

        return { ...research, copiedFrom: original.id };
    }

    // ---------- modelos ----------

    async fromTemplate(dto: CreateFromTemplateDto, currentUser: UserPayLoad) {
        const template = TEMPLATES.find((t) => t.id === dto.templateId);
        if (!template) throw new NotFoundException('Template not found');
        const companyId = this.companyFor(currentUser, dto.companyId);

        const start = dto.startDate ? new Date(dto.startDate) : new Date();
        const end = dto.endDate ? new Date(dto.endDate) : new Date(start.getTime() + 30 * DAY_MS);
        if (end < start) throw new BadRequestException('The end date cannot be earlier than the start date');

        return await this.prisma.client.transaction(async (tx) => {
            const created = await tx.orm.public.Research.create({
                title: dto.title?.trim() || template.name,
                description: dto.description?.trim() || template.description,
                objective: dto.objective?.trim() || template.objective,
                targetAudience: dto.targetAudience?.trim() || template.targetAudience,
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                status: 'DRAFT',
                recordInterview: template.recordInterview ?? false,
                companyId,
            });
            await this.writeSpec(tx.orm.public, created.id, template);
            return { ...created, templateId: template.id };
        });
    }

    // ---------- modelos personalizados (salvar uma pesquisa como modelo / importar JSON) ----------

    /** Estrutura de uma pesquisa existente, num arquivo de modelo pronto para baixar e importar depois. */
    async exportTemplate(id: number, currentUser: UserPayLoad) {
        const research = await this.researchService.findOne(id, currentUser);
        if (currentUser.profile === 'RESEARCHER') throw new ForbiddenException('Researchers cannot export templates');
        const spec = await this.exportSpec(research.id);
        return {
            format: 'pesquisa-aqui-template',
            version: 1,
            name: research.title,
            category: 'Personalizado',
            description: research.description ?? '',
            objective: research.objective ?? '',
            targetAudience: research.targetAudience ?? '',
            recordInterview: research.recordInterview ?? false,
            sections: spec.sections,
            rules: spec.rules,
        };
    }

    /** Rascunho a partir de um modelo personalizado (o JSON salvo ou importado). A estrutura é revalidada aqui. */
    async fromSpec(dto: CreateFromSpecDto, currentUser: UserPayLoad) {
        const companyId = this.companyFor(currentUser, dto.companyId);
        const spec = sanitizeSpec(dto.spec);

        const start = dto.startDate ? new Date(dto.startDate) : new Date();
        const end = dto.endDate ? new Date(dto.endDate) : new Date(start.getTime() + 30 * DAY_MS);
        if (end < start) throw new BadRequestException('The end date cannot be earlier than the start date');

        return await this.prisma.client.transaction(async (tx) => {
            const created = await tx.orm.public.Research.create({
                title: dto.title?.trim() || dto.name?.trim() || 'Pesquisa a partir de modelo',
                description: dto.description?.trim() || 'Pesquisa criada a partir de um modelo personalizado.',
                objective: dto.objective?.trim() || 'Definir o objetivo da pesquisa.',
                targetAudience: dto.targetAudience?.trim() || 'Definir o público-alvo.',
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                status: 'DRAFT',
                recordInterview: dto.recordInterview ?? false,
                companyId,
            });
            await this.writeSpec(tx.orm.public, created.id, spec);
            return created;
        });
    }

    // ---------- estrutura <-> banco ----------

    /** Grava seções, questões, opções e regras de `spec` na pesquisa (dentro da transação de quem chama). */
    async writeSpec(orm: ReturnType<ResearchTemplateService['ormOf']>, researchId: number, spec: QuestionnaireSpec) {
        const questionIds = new Map<string, number>();
        const optionIds = new Map<string, number[]>();
        const sectionIds: number[] = [];
        const typeOf = new Map<string, string>();

        for (const [sectionIndex, section] of spec.sections.entries()) {
            const createdSection = await orm.Section.create({ title: section.title, order: sectionIndex + 1, researchId });
            sectionIds.push(createdSection.id);

            for (const [questionIndex, question] of section.questions.entries()) {
                const row = await orm.Question.create({
                    statement: question.statement,
                    type: question.type as any,
                    helpText: question.helpText ?? null,
                    isRequired: question.isRequired ?? false,
                    order: questionIndex + 1,
                    sectionId: createdSection.id,
                    minSelections: question.minSelections ?? null,
                    maxSelections: question.maxSelections ?? null,
                    minValue: question.minValue ?? null,
                    maxValue: question.maxValue ?? null,
                    minDate: question.minDate ?? null,
                    maxDate: question.maxDate ?? null,
                    maxLength: question.maxLength ?? null,
                    scaleLeftLabel: question.scaleLeftLabel ?? null,
                    scaleRightLabel: question.scaleRightLabel ?? null,
                    maxFiles: question.maxFiles ?? null,
                    maxDuration: question.maxDuration ?? null,
                });
                questionIds.set(question.key, row.id);
                typeOf.set(question.key, question.type);

                const ids: number[] = [];
                if (CHOICE.includes(question.type)) {
                    for (const [optionIndex, text] of (question.options ?? []).entries()) {
                        ids.push((await orm.QuestionOption.create({ text, order: optionIndex + 1, questionId: row.id })).id);
                    }
                }
                optionIds.set(question.key, ids);
            }
        }

        for (const rule of spec.rules) {
            const groupKey = rule.conditions.length > 1 ? randomUUID() : null;
            const targetQuestionId = rule.targetKey !== undefined ? questionIds.get(rule.targetKey) : undefined;
            const targetSectionId = rule.targetSectionIndex !== undefined ? sectionIds[rule.targetSectionIndex] : undefined;
            if ((targetQuestionId === undefined) === (targetSectionId === undefined)) throw new BadRequestException('Regra do modelo sem alvo válido');

            for (const condition of rule.conditions) {
                const sourceId = questionIds.get(condition.sourceKey);
                if (sourceId === undefined) throw new BadRequestException(`Regra do modelo aponta para uma questão que não existe: ${condition.sourceKey}`);
                const isChoice = CHOICE.includes(typeOf.get(condition.sourceKey) ?? '');
                const optionId = condition.optionIndex !== undefined ? optionIds.get(condition.sourceKey)?.[condition.optionIndex] : undefined;
                if (isChoice && condition.optionIndex !== undefined && optionId === undefined) throw new BadRequestException('Regra do modelo aponta para uma opção que não existe');

                await orm.QuestionRule.create({
                    researchId,
                    sourceQuestionId: sourceId,
                    operator: condition.operator ?? 'EQ',
                    triggerValue: optionId !== undefined ? String(optionId) : (condition.value ?? ''),
                    targetQuestionId: targetQuestionId ?? null,
                    targetSectionId: targetSectionId ?? null,
                    action: rule.action ?? 'SHOW',
                    groupKey,
                });
            }
        }
    }

    // Só para dar nome ao tipo do cliente de banco (transação ou não).
    private ormOf() {
        return this.orm;
    }

    /** Lê a estrutura de uma pesquisa existente no mesmo formato dos modelos. */
    async exportSpec(researchId: number): Promise<QuestionnaireSpec> {
        const sections = [...(await this.orm.Section.where({ researchId }).all())].sort((a, b) => a.order - b.order || a.id - b.id);
        const sectionIndex = new Map(sections.map((s, i) => [s.id, i]));
        const keyOf = (id: number) => `q${id}`;

        const specSections: SpecSection[] = [];
        const optionIndexOf = new Map<string, number>(); // `${questionId}:${optionId}` -> posição

        for (const section of sections) {
            const rows = [...(await this.orm.Question.where({ sectionId: section.id }).all())].sort((a, b) => a.order - b.order || a.id - b.id);
            const questions: SpecQuestion[] = [];
            for (const row of rows) {
                let options: string[] | undefined;
                if (CHOICE.includes(row.type)) {
                    const list = [...(await this.orm.QuestionOption.where({ questionId: row.id }).all())].sort((a, b) => a.order - b.order || a.id - b.id);
                    options = list.map((o) => o.text);
                    list.forEach((o, i) => optionIndexOf.set(`${row.id}:${o.id}`, i));
                }
                questions.push({
                    key: keyOf(row.id),
                    statement: row.statement,
                    type: row.type,
                    helpText: row.helpText,
                    isRequired: row.isRequired,
                    options,
                    minSelections: row.minSelections,
                    maxSelections: row.maxSelections,
                    minValue: row.minValue,
                    maxValue: row.maxValue,
                    minDate: row.minDate,
                    maxDate: row.maxDate,
                    maxLength: row.maxLength,
                    scaleLeftLabel: row.scaleLeftLabel,
                    scaleRightLabel: row.scaleRightLabel,
                    maxFiles: row.maxFiles,
                    maxDuration: row.maxDuration,
                });
            }
            specSections.push({ title: section.title, questions });
        }

        const typeById = new Map<string, string>(specSections.flatMap((s) => s.questions.map((x) => [x.key, x.type] as [string, string])));
        const rows = await this.orm.QuestionRule.where({ researchId }).all();
        const rules: SpecRule[] = [];
        const grouped = new Map<string, SpecRule>();

        for (const row of rows) {
            const sourceKey = keyOf(row.sourceQuestionId);
            const isChoice = CHOICE.includes(typeById.get(sourceKey) ?? '');
            const index = isChoice ? optionIndexOf.get(`${row.sourceQuestionId}:${row.triggerValue}`) : undefined;
            const condition = isChoice && index !== undefined
                ? { sourceKey, operator: row.operator, optionIndex: index }
                : { sourceKey, operator: row.operator, value: row.triggerValue };
            // Regra apontando para uma opção que já não existe é descartada (já era inválida).
            if (isChoice && row.operator !== 'ANSWERED' && row.operator !== 'NOT_ANSWERED' && index === undefined) continue;

            const targetSectionIdx = row.targetSectionId !== null && row.targetSectionId !== undefined ? sectionIndex.get(row.targetSectionId) : undefined;
            const base = {
                targetKey: row.targetQuestionId !== null && row.targetQuestionId !== undefined ? keyOf(row.targetQuestionId) : undefined,
                targetSectionIndex: targetSectionIdx,
                action: (row.action === 'HIDE' ? 'HIDE' : 'SHOW') as 'SHOW' | 'HIDE',
            };
            if (base.targetKey === undefined && base.targetSectionIndex === undefined) continue;

            if (row.groupKey) {
                let rule = grouped.get(row.groupKey);
                if (!rule) {
                    rule = { ...base, conditions: [] };
                    grouped.set(row.groupKey, rule);
                    rules.push(rule);
                }
                rule.conditions.push(condition);
            } else {
                rules.push({ ...base, conditions: [condition] });
            }
        }

        return { sections: specSections, rules };
    }
}

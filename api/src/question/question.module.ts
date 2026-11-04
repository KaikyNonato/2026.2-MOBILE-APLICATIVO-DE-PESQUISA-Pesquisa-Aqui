import { Module } from '@nestjs/common';
import { QuestionService } from './question.service.js';
import { QuestionController } from './question.controller.js';
import { PrismaModule } from '../prisma.module.js';
import { SectionModule } from '../section/section.module.js';
import { StorageModule } from '../collection/storage.module.js';
import { ResearchService } from '../research/research.service.js';
import { QuestionRuleModule } from '../question-rule/question-rule.module.js';

/** Módulo das questões e alternativas do questionário. */
@Module({
  imports: [PrismaModule, StorageModule, SectionModule, QuestionRuleModule],
  controllers: [QuestionController],
  providers: [QuestionService, ResearchService],
})
export class QuestionModule { }

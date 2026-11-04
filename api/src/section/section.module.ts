import { Module } from '@nestjs/common';
import { SectionService } from './section.service.js';
import { SectionController } from './section.controller.js';
import { PrismaModule } from '../prisma.module.js';
import { StorageModule } from '../collection/storage.module.js';
import { ResearchService } from '../research/research.service.js';
import { QuestionRuleModule } from '../question-rule/question-rule.module.js';

/** Módulo das seções do questionário de uma pesquisa. */
@Module({
  imports: [PrismaModule, StorageModule, QuestionRuleModule],
  controllers: [SectionController],
  providers: [SectionService, ResearchService],
  exports: [SectionService],
})
export class SectionModule { }

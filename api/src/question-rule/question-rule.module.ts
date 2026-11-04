import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module.js';
import { StorageModule } from '../collection/storage.module.js';
import { ResearchService } from '../research/research.service.js';
import { QuestionRuleController } from './question-rule.controller.js';
import { QuestionRuleService } from './question-rule.service.js';

/** Módulo das regras de exibição condicional das questões. */
@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [QuestionRuleController],
  providers: [QuestionRuleService, ResearchService],
  exports: [QuestionRuleService],
})
export class QuestionRuleModule { }

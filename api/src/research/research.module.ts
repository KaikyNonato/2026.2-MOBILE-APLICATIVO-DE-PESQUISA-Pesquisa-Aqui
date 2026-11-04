import { Module } from '@nestjs/common';
import { ResearchController } from './research.controller.js';
import { ResearchService } from './research.service.js';
import { ResearchReportService } from './research-report.service.js';
import { ResearchTemplateService } from './research-template.service.js';
import { PrismaModule } from '../prisma.module.js';
import { StorageModule } from '../collection/storage.module.js';

/** Módulo de pesquisas: cadastro, relatórios, exportações e modelos. */
@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [ResearchController],
  providers: [ResearchService, ResearchReportService, ResearchTemplateService],
  exports: [ResearchService],
})
export class ResearchModule { }

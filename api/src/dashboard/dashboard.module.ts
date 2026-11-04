import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

/** Módulo do painel (dashboard) do administrador. */
@Module({
  imports: [PrismaModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule { }

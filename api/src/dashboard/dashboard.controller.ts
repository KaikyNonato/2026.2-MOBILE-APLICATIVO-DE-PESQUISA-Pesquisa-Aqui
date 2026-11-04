import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { DashboardService } from './dashboard.service.js';

/** Parâmetros do painel: o fuso horário do navegador do usuário. */
class DashboardQueryDto {
  /** `new Date().getTimezoneOffset()` do navegador (minutos). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-840)
  @Max(840)
  tzOffset?: number;
}

/** Rotas do painel (`/dashboard`). Todas exigem login. */
@UseGuards(AuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) { }

  /**
   * Painel do administrador: totais, gráficos e listas curtas, já calculados (nada de listas
   * inteiras).
   */
  @Get('admin')
  @Header('Cache-Control', 'private, no-store')
  admin(@Query() query: DashboardQueryDto, @CurrentUser() currentUser: UserPayLoad) {
    return this.dashboardService.admin(currentUser, query.tzOffset ?? 0);
  }
}

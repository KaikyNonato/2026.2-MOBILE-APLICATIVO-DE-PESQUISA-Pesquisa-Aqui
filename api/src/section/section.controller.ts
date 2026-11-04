import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, ParseIntPipe } from '@nestjs/common';
import { SectionService } from './section.service.js';
import { CreateSectionDto } from './dto/create-section.dto.js';
import { UpdateSectionDto } from './dto/update-section.dto.js';
import { ReorderSectionsDto } from './dto/reorder-sections.dto.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserPayLoad } from '../auth/current-user.type.js';

/** Rotas de seções (`/section`). Todas exigem login. */
@UseGuards(AuthGuard)
@Controller('section')
export class SectionController {
  constructor(private readonly sectionService: SectionService) { }

  /** Cria uma seção em uma pesquisa (`POST /section`). */
  @Post()
  create(@Body() createSectionDto: CreateSectionDto, @CurrentUser() currentUser: UserPayLoad) {
    return this.sectionService.create(createSectionDto, currentUser);
  }

  /** Declarada antes das rotas com :id para nunca ser confundida com um id. */
  @Post('reorder')
  reorder(@Body() reorderDto: ReorderSectionsDto, @CurrentUser() currentUser: UserPayLoad) {
    return this.sectionService.reorder(reorderDto, currentUser);
  }

  /** Declarada antes de ':id'. Traz seções, questões e alternativas de uma vez. */
  @Get('questionnaire')
  questionnaire(@Query('researchId', ParseIntPipe) researchId: number, @CurrentUser() currentUser: UserPayLoad) {
    return this.sectionService.questionnaire(researchId, currentUser);
  }

  /** Lista as seções de uma pesquisa (`GET /section?researchId=`). */
  @Get()
  findAll(@Query('researchId', ParseIntPipe) researchId: number, @CurrentUser() currentUser: UserPayLoad) {
    return this.sectionService.findAll(researchId, currentUser);
  }

  /** Busca uma seção pelo id (`GET /section/:id`). */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad) {
    return this.sectionService.findOne(id, currentUser);
  }

  /**
   * Edita uma seção (`PATCH /section/:id`). Com `?force=true`, confirma mesmo quando regras de
   * exibição são afetadas.
   */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateSectionDto: UpdateSectionDto, @CurrentUser() CurrentUser: UserPayLoad, @Query('force') force?: string) {
    return this.sectionService.update(id, updateSectionDto, CurrentUser, force === 'true');
  }

  /**
   * Exclui uma seção (`DELETE /section/:id`). Com `?force=true`, confirma mesmo quando regras de
   * exibição são afetadas.
   */
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad, @Query('force') force?: string) {
    return this.sectionService.delete(id, currentUser, force === 'true');
  }
}

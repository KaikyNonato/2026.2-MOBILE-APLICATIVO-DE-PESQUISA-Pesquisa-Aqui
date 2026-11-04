import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, ParseIntPipe } from '@nestjs/common';
import { QuestionService } from './question.service.js';
import { CreateQuestionDto } from './dto/create-question.dto.js';
import { UpdateQuestionDto } from './dto/update-question.dto.js';
import { ReorderQuestionsDto } from './dto/reorder-questions.dto.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { AuthGuard } from '../auth/auth.guard.js';

/** Rotas de questões e alternativas (`/question`). Todas exigem login. */
@UseGuards(AuthGuard)
@Controller('question')
export class QuestionController {
  constructor(private readonly questionService: QuestionService) { }

  /** Cria uma questão em uma seção (`POST /question`). */
  @Post()
  create(@Body() createQuestionDto: CreateQuestionDto, @CurrentUser() currentUser: UserPayLoad) {
    return this.questionService.create(createQuestionDto, currentUser);
  }

  /** Declarada antes das rotas com :id para nunca ser confundida com um id. */
  @Post('reorder')
  reorder(@Body() reorderDto: ReorderQuestionsDto, @CurrentUser() currentUser: UserPayLoad) {
    return this.questionService.reorder(reorderDto, currentUser);
  }

  /** Lista as questões de uma seção (`GET /question?sectionId=`). */
  @Get()
  findAll(@Query('sectionId', ParseIntPipe) sectionId: number, @CurrentUser() currentUser: UserPayLoad) {
    return this.questionService.findAll(sectionId, currentUser);
  }

  /** Busca uma questão pelo id (`GET /question/:id`). */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad) {
    return this.questionService.findOne(id, currentUser);
  }

  /**
   * Edita uma questão (`PATCH /question/:id`). Com `?force=true`, confirma mesmo quando regras de
   * exibição são afetadas.
   */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateQuestionDto: UpdateQuestionDto, @CurrentUser() currentUser: UserPayLoad, @Query('force') force?: string) {
    return this.questionService.update(id, updateQuestionDto, currentUser, force === 'true');
  }

  /**
   * Exclui uma questão (`DELETE /question/:id`). Com `?force=true`, confirma mesmo quando regras de
   * exibição são afetadas.
   */
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad, @Query('force') force?: string) {
    return this.questionService.delete(id, currentUser, force === 'true');
  }

  /** Cria uma alternativa de resposta da questão (`POST /question/:id/option`). */
  @Post(':id/option')
  createOption(@Param('id') id: string, @Body() body: { text: string; order: number }, @CurrentUser() currentUser: UserPayLoad) {
    return this.questionService.createOption(+id, body.text, body.order, currentUser);
  }

  /** Lista as alternativas de uma questão (`GET /question/:id/options`). */
  @Get(':id/options')
  getOptions(@Param('id') id: string) {
    return this.questionService.getOptions(+id);
  }

  /** Edita o texto ou a ordem de uma alternativa (`PATCH /question/option/:id`). */
  @Patch('option/:id')
  updateOption(@Param('id') id: string, @Body() body: { text?: string; order?: number }, @CurrentUser() currentUser: UserPayLoad) {
    return this.questionService.updateOption(+id, currentUser, body.text, body.order);
  }

  /**
   * Exclui uma alternativa (`DELETE /question/option/:id`). Com `?force=true`, confirma mesmo
   * quando regras são afetadas.
   */
  @Delete('option/:id')
  deleteOption(@Param('id') id: string, @CurrentUser() currentUser: UserPayLoad, @Query('force') force?: string) {
    return this.questionService.deleteOption(+id, currentUser, force === 'true');
  }
}

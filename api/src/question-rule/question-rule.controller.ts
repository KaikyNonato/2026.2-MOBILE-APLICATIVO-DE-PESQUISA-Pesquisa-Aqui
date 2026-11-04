import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { CreateQuestionRuleDto } from './dto/create-question-rule.dto.js';
import { QuestionRuleService } from './question-rule.service.js';

/** Rotas das regras de exibição condicional (`/question-rule`). Todas exigem login. */
@UseGuards(AuthGuard)
@Controller('question-rule')
export class QuestionRuleController {
  constructor(private readonly questionRuleService: QuestionRuleService) { }

  /** Cria uma regra de exibição (`POST /question-rule`). */
  @Post()
  create(@Body() dto: CreateQuestionRuleDto, @CurrentUser() currentUser: UserPayLoad) {
    return this.questionRuleService.create(dto, currentUser);
  }

  /** Lista as regras de uma pesquisa (`GET /question-rule?researchId=`). */
  @Get()
  findAll(@Query('researchId', ParseIntPipe) researchId: number, @CurrentUser() currentUser: UserPayLoad) {
    return this.questionRuleService.findAll(researchId, currentUser);
  }

  /** Apaga uma regra (`DELETE /question-rule/:id`). */
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad) {
    return this.questionRuleService.delete(id, currentUser);
  }
}

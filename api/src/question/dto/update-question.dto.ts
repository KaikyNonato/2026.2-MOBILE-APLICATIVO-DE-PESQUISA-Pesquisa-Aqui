import { PartialType } from '@nestjs/mapped-types';
import { CreateQuestionDto } from './create-question.dto.js';

/** Dados editáveis de uma questão (os mesmos da criação, todos opcionais). */
export class UpdateQuestionDto extends PartialType(CreateQuestionDto) { }

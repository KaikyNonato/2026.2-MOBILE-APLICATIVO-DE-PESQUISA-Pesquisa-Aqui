import { PartialType } from '@nestjs/mapped-types';
import { CreateSectionDto } from './create-section.dto.js';

/** Dados editáveis de uma seção (os mesmos da criação, todos opcionais). */
export class UpdateSectionDto extends PartialType(CreateSectionDto) { }

import { PartialType } from '@nestjs/mapped-types';
import { CreateCompanyDto } from './create-company.dto.js';

/** Dados editáveis de uma empresa (os mesmos do cadastro, todos opcionais). */
export class UpdateCompanyDto extends PartialType(CreateCompanyDto) { }

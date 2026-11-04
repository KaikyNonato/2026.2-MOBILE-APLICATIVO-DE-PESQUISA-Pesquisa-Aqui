import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/** Dados opcionais ao duplicar uma pesquisa (como um novo título). */
export class DuplicateResearchDto {
  // Padrão: "<título original> (cópia)".
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;
}

/**
 * Dados para criar um rascunho a partir de um modelo pronto: o modelo, a empresa, o título e as
 * datas.
 */
export class CreateFromTemplateDto {
  @IsString()
  @IsNotEmpty()
  templateId: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  objective?: string;

  @IsOptional()
  @IsString()
  targetAudience?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  // Só para superadministrador.
  @IsOptional()
  @IsInt()
  companyId?: number;
}

/** Modelo salvo pela empresa: guardado no servidor, a partir de um arquivo JSON importado. */
export class SaveTemplateDto {
  // Estrutura do modelo ({ sections, rules }). É validada e normalizada no serviço.
  @IsObject()
  spec: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  objective?: string;

  @IsOptional()
  @IsString()
  targetAudience?: string;

  @IsOptional()
  @IsBoolean()
  recordInterview?: boolean;

  // Só para superadministrador.
  @IsOptional()
  @IsInt()
  companyId?: number;
}

/** Rascunho a partir de um modelo salvo. */
export class CreateFromSavedDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;
}

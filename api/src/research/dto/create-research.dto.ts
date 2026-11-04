import { IsBoolean, IsDateString, IsEnum, IsInt, IsLatitude, IsLongitude, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min, ValidateIf } from "class-validator";

export enum ResearchStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  IN_FIELD = 'IN_FIELD',
  CLOSED = 'CLOSED',
}

/**
 * Dados para criar uma pesquisa: título, descrição, objetivo, público-alvo, período, gravação da
 * entrevista e área de atuação.
 */
export class CreateResearchDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  description: string;

  @IsNotEmpty()
  @IsString()
  objective: string;

  @IsNotEmpty()
  @IsDateString()
  startDate: string;

  @IsNotEmpty()
  @IsDateString()
  endDate: string;

  @IsNotEmpty()
  @IsString()
  targetAudience: string;

  @IsOptional()
  @IsEnum(ResearchStatus)
  status?: ResearchStatus;

  @IsOptional()
  @IsInt()
  companyId?: number;

  // Grava a entrevista inteira (áudio) e exige o consentimento do entrevistado.
  @IsOptional()
  @IsBoolean()
  recordInterview?: boolean;

  // Área-alvo (círculo): coletas que começam fora dela são sinalizadas na auditoria de qualidade.
  // Enviar `null` nos três campos remove a área. Latitude e longitude do centro, e o raio em km.
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsLatitude()
  areaLatitude?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsLongitude()
  areaLongitude?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0.05)
  @Max(20000)
  areaRadiusKm?: number | null;
}

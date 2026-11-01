import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class DuplicateResearchDto {
    // Padrão: "<título original> (cópia)".
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    title?: string;
}

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

/** Pesquisa nova (rascunho) a partir de um modelo personalizado: o JSON salvo/importado pelo usuário. */
export class CreateFromSpecDto {
    // Estrutura do modelo ({ sections, rules }). É validada e normalizada no serviço.
    @IsObject()
    spec: Record<string, unknown>;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    name?: string;

    @IsOptional()
    @IsString()
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
    @IsBoolean()
    recordInterview?: boolean;

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

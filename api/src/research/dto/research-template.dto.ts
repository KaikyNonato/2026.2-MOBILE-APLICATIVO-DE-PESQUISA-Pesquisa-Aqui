import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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

import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Campos de texto que acompanham o arquivo enviado em POST /collection/:clientId/files.
 * O arquivo vem no campo multipart `file`; a coleta é identificada pelo UUID da rota.
 */
export class UploadCollectionFileDto {
  // Questão a que o arquivo pertence. Sem ela, o arquivo é o áudio da entrevista.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  questionId?: number;

  // Nome do arquivo no aparelho (o mesmo valor guardado na resposta da questão).
  // É a identidade do arquivo: enviar de novo o mesmo nome não grava outra cópia.
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 60 * 60)
  durationSeconds?: number;
}

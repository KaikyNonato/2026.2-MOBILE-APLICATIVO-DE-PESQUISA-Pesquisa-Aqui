import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { UploadCollectionFileDto } from './upload-collection-file.dto.js';

/**
 * Campos que acompanham cada pedaço em POST /collection/:clientId/files/chunk.
 * O pedaço vem no campo multipart `file`. Os campos de identificação (name, questionId,
 * durationSeconds)
 * são os mesmos do envio de arquivo inteiro e se repetem em todos os pedaços.
 */
export class UploadFileChunkDto extends UploadCollectionFileDto {
  // Posição do primeiro byte deste pedaço dentro do arquivo.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number;

  // Tamanho do arquivo inteiro: o servidor sabe que terminou quando recebe esse total.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalBytes: number;

  // Tipo do arquivo inteiro (image/jpeg, audio/mp4...).
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  mimeType: string;
}

/** Parâmetros de GET /collection/:clientId/files/progress: "quanto deste arquivo você já tem?". */
export class FileProgressQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  questionId?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  totalBytes: number;
}

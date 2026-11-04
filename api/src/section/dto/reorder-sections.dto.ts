import { ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsOptional } from 'class-validator';

/** Nova ordem das seções de uma pesquisa: a pesquisa e os ids de todas as seções, na ordem desejada. */
export class ReorderSectionsDto {
  @IsInt()
  researchId: number;

  // IDs de TODAS as seções da pesquisa, na nova ordem.
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  orderedIds: number[];

  // Confirma a exclusão das regras que a nova ordem deixaria apontando para trás.
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

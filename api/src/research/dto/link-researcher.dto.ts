import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_RESEARCHER_TARGET = 1_000_000;

/** Corpo opcional de POST /research/:id/researchers/:userId. */
export class LinkResearcherDto {
  // Meta de coletas do pesquisador nesta pesquisa (ex.: 50, 120).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RESEARCHER_TARGET)
  targetCount?: number;
}

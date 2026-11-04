import { IsInt, Max, Min } from 'class-validator';
import { MAX_RESEARCHER_TARGET } from './link-researcher.dto.js';

/** Corpo de PATCH /research/:id/researchers/:userId (altera a meta, mesmo com a pesquisa em campo). */
export class UpdateResearcherTargetDto {
  @IsInt()
  @Min(1)
  @Max(MAX_RESEARCHER_TARGET)
  targetCount: number;
}

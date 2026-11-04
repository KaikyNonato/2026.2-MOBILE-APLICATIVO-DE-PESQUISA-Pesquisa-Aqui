import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Corpo de POST /research/:id/copies/:copyId/revoke. */
export class RevokeCopyDto {
  // Por que a cópia foi revogada (aparelho perdido, quebrado, pesquisador que saiu...). Fica no histórico.
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

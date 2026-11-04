import { IsIn } from 'class-validator';

/** Corpo para ativar ou desativar um usuário (`ACTIVE` ou `INACTIVE`). */
export class UpdateUserSituationDto {
  @IsIn(['ACTIVE', 'INACTIVE'])
  situation: 'ACTIVE' | 'INACTIVE';
}

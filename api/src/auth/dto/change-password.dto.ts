import { IsNotEmpty, IsString } from 'class-validator';
import { StrongPassword } from '../password-policy.js';

/** Corpo da troca de senha: a senha atual e a nova senha, que precisa seguir a política de senha. */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @StrongPassword()
  newPassword: string;
}

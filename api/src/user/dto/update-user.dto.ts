import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { StrongPassword } from '../../auth/password-policy.js';

/** Dados que podem ser alterados em um usuário. Tudo é opcional: só o que vier é alterado. */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  username?: string;

  // Só é enviada quando a senha vai ser trocada.
  @IsOptional()
  @StrongPassword()
  password?: string;
}

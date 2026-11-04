import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

/** Corpo do login: usuário, senha e, opcionalmente, a plataforma de origem (`web` ou `mobile`). */
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsOptional()
  @IsString()
  @IsIn(['web', 'mobile'])
  platform?: string;
}

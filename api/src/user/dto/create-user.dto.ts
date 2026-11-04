import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { StrongPassword } from '../../auth/password-policy.js';

export enum Profile {
  SUPERADMINISTRATOR = 'SUPERADMINISTRATOR',
  ADMINISTRATOR = 'ADMINISTRATOR',
  RESEARCHER = 'RESEARCHER',
}

/** Dados para cadastrar um usuário: nome, usuário, senha, perfil e, quando aplicável, a empresa. */
export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  username: string;

  @StrongPassword()
  password: string;

  @IsEnum(Profile)
  @IsNotEmpty()
  profile: Profile;

  @IsOptional()
  @IsInt()
  companyId?: number;
}

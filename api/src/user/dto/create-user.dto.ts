import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { StrongPassword } from '../../auth/password-policy.js';

export enum Profile {
    SUPERADMINISTRATOR = 'SUPERADMINISTRATOR',
    ADMINISTRATOR = 'ADMINISTRATOR',
    RESEARCHER = 'RESEARCHER',
}

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
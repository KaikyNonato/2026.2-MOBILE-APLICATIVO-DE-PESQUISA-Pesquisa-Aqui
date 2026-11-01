import { IsNotEmpty, IsString } from 'class-validator';
import { StrongPassword } from '../password-policy.js';

export class ChangePasswordDto {
    @IsString()
    @IsNotEmpty()
    currentPassword: string;

    @StrongPassword()
    newPassword: string;
}

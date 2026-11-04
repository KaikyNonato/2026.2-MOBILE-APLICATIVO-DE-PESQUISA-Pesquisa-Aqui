import { Throttle } from '@nestjs/throttler';
import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { AVATAR_MAX_BYTES, type UploadedImage } from './avatar-storage.js';
import type { Response } from 'express';
import { AuthGuard } from './auth.guard.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { AllowWhenPasswordChangeRequired } from './allow-password-change.decorator.js';

const COOKIE_NAME = 'access_token';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

/**
 * Opções do cookie de sessão: inacessível ao JavaScript, `secure` em produção e com validade de 7
 * dias.
 */
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: COOKIE_MAX_AGE_MS,
  path: '/',
});

/** Rotas de autenticação (`/auth`): login, logout, perfil, troca de senha e foto de perfil. */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  /** Limite por IP (além do bloqueio por conta no AuthService): 10 tentativas por minuto. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { access_token, mustChangePassword } = await this.authService.login(loginDto);

    res.cookie(COOKIE_NAME, access_token, cookieOptions());

    return { access_token, mustChangePassword, message: 'Logged in successfully' };
  }

  /** Encerra a sessão apagando o cookie de acesso. */
  @Post('logout')
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_NAME, { path: '/' });

    return { message: 'Logged out' };
  }

  /** Dados básicos do usuário logado. Fica aberta para quem ainda precisa trocar a senha temporária. */
  @AllowWhenPasswordChangeRequired()
  @UseGuards(AuthGuard)
  @Get('me')
  async me(@Req() req: Request) {
    return this.authService.getMe(req['user']);
  }

  /** Perfil do usuário logado, direto do banco (nome, usuário, empresa, datas). */
  @AllowWhenPasswordChangeRequired()
  @UseGuards(AuthGuard)
  @Get('profile')
  async profile(@Req() req: Request) {
    return this.authService.getProfile(req['user']);
  }

  /**
   * O usuário edita o próprio nome, usuário e senha. O cookie é renovado porque o token carrega
   * nome e usuário.
   */
  @UseGuards(AuthGuard)
  @Patch('profile')
  async updateProfile(
    @Req() req: Request,
    @Body() dto: UpdateProfileDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { profile, access_token } = await this.authService.updateProfile(req['user'], dto);

    res.cookie(COOKIE_NAME, access_token, cookieOptions());

    return profile;
  }

  /** Troca de senha de qualquer perfil. Aberta também para quem está com senha temporária. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AllowWhenPasswordChangeRequired()
  @UseGuards(AuthGuard)
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @Req() req: Request,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { access_token, message } = await this.authService.changePassword(req['user'], dto);

    res.cookie(COOKIE_NAME, access_token, cookieOptions());

    return { access_token, message };
  }

  /**
   * Foto de perfil (multipart/form-data, campo `file`: JPG, PNG ou WebP). Devolve o perfil já com o
   * novo endereço.
   */
  @UseGuards(AuthGuard)
  @Post('avatar')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }))
  async uploadAvatar(@Req() req: Request, @UploadedFile() file: UploadedImage | undefined) {
    return this.authService.setAvatar(req['user'], file);
  }

  /** Remove a foto de perfil do usuário logado. */
  @UseGuards(AuthGuard)
  @Delete('avatar')
  async removeAvatar(@Req() req: Request) {
    return this.authService.removeAvatar(req['user']);
  }
}

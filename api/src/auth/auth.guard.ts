import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma.service.js';
import { ALLOW_PASSWORD_CHANGE_KEY } from './allow-password-change.decorator.js';
import { passwordVersion } from './token-payload.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Token not provided');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET
      });

      if (payload.companyId) {
        const company = await this.prisma.client.orm.public.Company.where({ id: payload.companyId }).first()

        if (company && company.situation == 'INACTIVE') {
          throw new UnauthorizedException('Your session has ended because the company has been deactivated')
        }
      }

      // A conta é conferida no banco a cada requisição: quem foi desativado, excluído ou trocou a senha perde a sessão
      // na hora, sem esperar o token expirar.
      const user = payload.sub
        ? await this.prisma.client.orm.public.User.where({ username: String(payload.sub) }).first()
        : null;

      if (!user) {
        throw new UnauthorizedException('Your session has ended because your account no longer exists')
      }

      if (user.situation === 'INACTIVE') {
        throw new UnauthorizedException('Your session has ended because your account has been deactivated')
      }

      if (payload.pv !== passwordVersion(user.passwordHash)) {
        throw new UnauthorizedException('Your session has ended because your password was changed')
      }

      // Senha temporária: só deixa ver o próprio perfil, trocar a senha e sair, até a troca ser feita.
      if (user.mustChangePassword === true) {
        const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_KEY, [
          context.getHandler(),
          context.getClass(),
        ]);

        if (!allowed) {
          throw new ForbiddenException({
            statusCode: 403,
            code: 'PASSWORD_CHANGE_REQUIRED',
            message: 'You must change your temporary password before continuing',
          })
        }
      }

      request['user'] = payload;

    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
        throw error
      }
      throw new UnauthorizedException('Invalid or expired token');
    }

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const cooketToken = request.cookies?.['access_token'];

    if (cooketToken) return cooketToken;

    const [type, headerToken] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? headerToken : undefined;
  }
}

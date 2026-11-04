import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AvatarStorage } from './avatar-storage.js';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma.module.js';
import { UserModule } from '../user/user.module.js';

/**
 * Módulo de autenticação: login, perfil do usuário logado, troca de senha e foto de perfil.
 * Registra o JWT de forma global.
 */
@Module({
  imports: [
    PrismaModule,
    UserModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '12h') as any },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AvatarStorage],
})
export class AuthModule { }

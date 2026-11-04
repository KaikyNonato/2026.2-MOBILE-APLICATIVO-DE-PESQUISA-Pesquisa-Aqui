import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaService } from './prisma.service.js';
import { CompanyModule } from './company/company.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UserModule } from './user/user.module.js';
import { ResearchModule } from './research/research.module.js';
import { SectionModule } from './section/section.module.js';
import { QuestionModule } from './question/question.module.js';
import { QuestionRuleModule } from './question-rule/question-rule.module.js';
import { CollectionModule } from './collection/collection.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { MediaModule } from './media/media.module.js';
import { MediaUrlInterceptor } from './media/media-url.interceptor.js';

/**
 * Módulo principal: reúne os módulos da API, o limite de requisições por IP e a troca dos endereços
 * do Cloudinary pelas rotas `/media`.
 */
@Module({
  imports: [
    // Limite geral por IP: 300 requisições por minuto. O login tem um limite próprio, mais baixo (ver AuthController).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    CompanyModule, AuthModule, UserModule, ResearchModule, SectionModule, QuestionModule, QuestionRuleModule, CollectionModule, DashboardModule, MediaModule],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Troca o endereço do Cloudinary das imagens por um caminho /media da própria API em todas as respostas.
    { provide: APP_INTERCEPTOR, useClass: MediaUrlInterceptor },
  ],
})
export class AppModule { }

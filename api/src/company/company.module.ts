import { Module } from '@nestjs/common';
import { CompanyController } from './company.controller.js';
import { CompanyService } from './company.service.js';
import { PrismaModule } from '../prisma.module.js';
import { AvatarStorage } from '../auth/avatar-storage.js';

/** Módulo de empresas, incluindo as imagens (logo e capa). */
@Module({
  imports: [PrismaModule],
  controllers: [CompanyController],
  providers: [CompanyService, AvatarStorage]
})
export class CompanyModule { }

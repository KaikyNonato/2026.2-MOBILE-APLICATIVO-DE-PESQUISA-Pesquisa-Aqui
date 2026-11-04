import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';

/** Módulo que entrega imagens (foto de perfil, logo e capa) pela própria API. */
@Module({
  imports: [PrismaModule],
  controllers: [MediaController],
  providers: [MediaService],
})
export class MediaModule { }

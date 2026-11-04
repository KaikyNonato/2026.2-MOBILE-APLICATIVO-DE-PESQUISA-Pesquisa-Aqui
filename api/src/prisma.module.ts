import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/** Módulo que expõe o `PrismaService` para os demais módulos. */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule { }

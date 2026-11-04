import { Injectable } from '@nestjs/common';
import { db } from './prisma/db.js';

/** Dá acesso ao cliente do banco de dados (Prisma Next) aos serviços da API. */
@Injectable()
export class PrismaService {
  get client() {
    return db;
  }
}

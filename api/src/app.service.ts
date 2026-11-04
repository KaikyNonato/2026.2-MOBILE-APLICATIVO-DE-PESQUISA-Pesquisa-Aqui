import { Injectable } from '@nestjs/common';

/** Serviço raiz da API. */
@Injectable()
export class AppService {
  /** Devolve o texto de teste da rota raiz. */
  getHello(): string {
    return 'Hello World!';
  }
}

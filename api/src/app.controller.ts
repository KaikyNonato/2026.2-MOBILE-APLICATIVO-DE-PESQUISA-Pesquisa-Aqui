import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

/** Controller raiz da API; responde à rota `GET /`. */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  /** Resposta simples usada para ver se a API está no ar. */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}

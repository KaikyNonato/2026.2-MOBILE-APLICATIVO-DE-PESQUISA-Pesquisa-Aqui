import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { corsOriginCheck, trustProxySetting } from './common/security.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Atrás de proxy (Vercel, Render, o rewrite do painel...) o IP real vem em X-Forwarded-For. Só confie nisso quando
  // houver mesmo um proxy na frente (TRUST_PROXY), senão qualquer um poderia forjar o IP e escapar do limite de requisições.
  const trustProxy = trustProxySetting();
  if (trustProxy !== false) app.set('trust proxy', trustProxy);

  app.use(
    helmet({
      // As imagens (/media) são carregadas pelo painel em outro endereço; a API só entrega, nunca embute páginas de terceiros.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(cookieParser());

  // Só as origens listadas em CORS_ORIGINS (separadas por vírgula) podem chamar a API a partir de um navegador.
  // O painel usa o caminho /api do próprio domínio e o app mobile não envia Origin, então nenhum dos dois depende disto.
  app.enableCors({
    origin: corsOriginCheck(),
    credentials: true,
  })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}

bootstrap();

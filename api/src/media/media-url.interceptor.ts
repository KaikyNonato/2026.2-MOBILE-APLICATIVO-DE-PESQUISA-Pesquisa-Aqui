import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

// Campos das respostas que guardam o endereço de uma imagem (foto de perfil, logo e capa da empresa).
const IMAGE_FIELDS = new Set(['avatarUrl', 'logoUrl', 'coverUrl', 'companyLogoUrl', 'researcherAvatarUrl']);

/**
 * Troca o endereço do Cloudinary (que fica no banco) por um caminho da própria API, como `/media/avatars/7?v=123`.
 * Assim o endereço do Cloudinary nunca chega ao navegador nem ao aplicativo: a imagem é entregue pela rota /media,
 * que busca no Cloudinary. O `v` é a versão da imagem e serve só para o navegador pegar a nova depois de uma troca.
 * Imagem que não é reconhecida vira null (não vaza o endereço original).
 */
export const mediaPathOf = (url: string): string | null => {
  if (!url.includes('res.cloudinary.com')) return url; // já é um caminho interno

  const version = /\/v(\d+)\//.exec(url)?.[1];
  const query = version ? `?v=${version}` : '';

  const avatar = /\/avatars\/user-(\d+)\.[a-z0-9]+(?:\?.*)?$/i.exec(url);
  if (avatar) return `/media/avatars/${avatar[1]}${query}`;

  const company = /\/companies\/company-(\d+)-(logo|cover)\.[a-z0-9]+(?:\?.*)?$/i.exec(url);
  if (company) return `/media/companies/${company[1]}/${company[2]}${query}`;

  return null;
};

/** Diz se o valor é um objeto simples (não é data, arquivo etc.), que pode ser percorrido. */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Percorre a resposta e troca os campos de imagem do endereço do Cloudinary pelo caminho `/media`
 * da própria API.
 */
const rewrite = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(rewrite);
  if (!isPlainObject(value)) return value; // Date, StreamableFile, números...

  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    out[key] = IMAGE_FIELDS.has(key) && typeof field === 'string' ? mediaPathOf(field) : rewrite(field);
  }
  return out;
};

/**
 * Interceptor global que aplica `rewrite` em toda resposta, para o endereço do Cloudinary nunca
 * chegar ao painel ou ao app.
 */
@Injectable()
export class MediaUrlInterceptor implements NestInterceptor {
  /** Aplica a troca de endereços ao corpo da resposta. */
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(rewrite));
  }
}

import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Paginação ÚNICA da API. As listagens do painel aceitam `?page=1&pageSize=20` e devolvem só aquela
// página, num envelope { items, total, page, pageSize, totalPages }.
//
// Compatível com o aplicativo: sem `page` e sem `pageSize` a rota continua devolvendo a lista inteira,
// no formato antigo (um array). O painel web sempre envia os dois.

export const DEFAULT_PAGE_SIZE = 20;
/** Teto de itens por página: ninguém consegue pedir "tudo de uma vez" pela paginação. */
export const MAX_PAGE_SIZE = 100;

/**
 * Parâmetros de paginação, busca e ordem aceitos por qualquer listagem
 * (`?page=&pageSize=&q=&sort=`).
 */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;

  /** Busca por texto (sem diferenciar maiúsculas). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** recent = mais novos primeiro; name = A-Z; deadline = prazo (só pesquisas). */
  @IsOptional()
  @IsIn(['recent', 'name', 'deadline'])
  sort?: 'recent' | 'name' | 'deadline';
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** A rota pediu paginação? (Sem isso, mantém o formato antigo: lista inteira.) */
export const isPaged = (query: Pick<PageQueryDto, 'page' | 'pageSize'>) =>
  query.page !== undefined || query.pageSize !== undefined;

/** Página e tamanho já com os padrões e o teto aplicados, mais o deslocamento para o banco. */
export function pageParams(query: Pick<PageQueryDto, 'page' | 'pageSize'>) {
  const pageSize = Math.min(Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const page = Math.max(1, query.page ?? 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Monta o envelope de resposta paginada: `items`, `total`, `page`, `pageSize` e `totalPages`. */
export function toPage<T>(items: T[], total: number, params: { page: number; pageSize: number }): Page<T> {
  return {
    items,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}

/** Pagina uma lista que já está em memória (listas montadas com cruzamentos, como cópias e vínculos). */
export function paginateList<T>(all: T[], query: Pick<PageQueryDto, 'page' | 'pageSize'>): Page<T> {
  const params = pageParams(query);
  return toPage(all.slice(params.offset, params.offset + params.pageSize), all.length, params);
}

/** Texto para busca: sem acento e em minúsculas ("João" acha "joao"). */
export const normalizeText = (text: string | null | undefined) =>
  (text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Escapa % e _ para a busca por texto no banco não tratá-los como curingas. */
export const likeTerm = (term: string) => `%${term.trim().replace(/[\\%_]/g, '\\$&')}%`;

/**
 * Executa uma listagem paginada.
 *
 * - Sem busca (`q`): o banco conta (`count`) e devolve só a página (`page`), com LIMIT/OFFSET.
 * - Com busca: o texto procura em vários campos, então a lista (já filtrada pelo escopo do usuário)
 *   é filtrada em memória por `searchText` e só a página sai na resposta.
 */
export async function runPaged<T>(
  query: Pick<PageQueryDto, 'page' | 'pageSize' | 'q'>,
  source: {
    count: () => Promise<number>;
    page: (limit: number, offset: number) => Promise<T[]>;
    all: () => Promise<T[]>;
    searchText?: (row: T) => string;
  },
): Promise<Page<T>> {
  const params = pageParams(query);
  const term = normalizeText(query.q?.trim());

  if (term && source.searchText) {
    const matching = (await source.all()).filter((row) => normalizeText(source.searchText!(row)).includes(term));
    return toPage(matching.slice(params.offset, params.offset + params.pageSize), matching.length, params);
  }

  const total = await source.count();
  const items = total === 0 ? [] : await source.page(params.pageSize, params.offset);
  return toPage(items, total, params);
}

/** Pesquisas: além de página, busca e ordem, filtra pela situação. */
export class ResearchPageQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'IN_FIELD', 'CLOSED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'IN_FIELD' | 'CLOSED';
}

/** Usuários e empresas: filtram pela situação. */
export class SituationPageQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  situation?: 'ACTIVE' | 'INACTIVE';
}

/** Coletas: filtram por haver ou não gravação. */
export class CollectionPageQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['AUDIO', 'NO_AUDIO'])
  audio?: 'AUDIO' | 'NO_AUDIO';
}

/** Usuários: situação (herdada) e perfil. */
export class UserPageQueryDto extends SituationPageQueryDto {
  @IsOptional()
  @IsIn(['SUPERADMINISTRATOR', 'ADMINISTRATOR', 'RESEARCHER'])
  profile?: 'SUPERADMINISTRATOR' | 'ADMINISTRATOR' | 'RESEARCHER';
}

/** Histórico de cópias: filtra por devolvidas ou revogadas. */
export class CopiesPageQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['ALL', 'RETURNED', 'REVOKED'])
  status?: 'ALL' | 'RETURNED' | 'REVOKED';
}

/** Equipe de uma pesquisa: filtra por vinculados ou disponíveis. */
export class TeamPageQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['ALL', 'LINKED', 'AVAILABLE'])
  filter?: 'ALL' | 'LINKED' | 'AVAILABLE';
}

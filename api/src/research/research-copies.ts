import { ForbiddenException } from '@nestjs/common';

/**
 * W11 — Trava do questionário por cópia ativa.
 *
 * Cada download de pesquisa registra uma "cópia" (linha em ResearchDownload): pesquisador + aparelho + data.
 * Enquanto existir ao menos uma cópia ativa, a ESTRUTURA do questionário (seções, questões, opções,
 * validações, regras de pulo e configuração de gravação) não muda. A regra é do servidor: todos os
 * caminhos de escrita da estrutura passam por `assertEditable` (research.service.ts).
 *
 * A cópia sai de "ativa" de duas formas, sempre registradas e nunca apagadas:
 *  - devolução, feita pelo próprio aparelho (`returnedAt`);
 *  - revogação forçada, feita pelo administrador (`revokedAt`, `revokedById`, `revokeReason`).
 * Quando a última sai, a contagem chega a zero e a pesquisa volta a ser editável sozinha: não existe
 * flag de "travada" gravada em lugar nenhum, o estado é sempre calculado a partir das cópias.
 */

export const RESEARCH_LOCKED_CODE = 'RESEARCH_LOCKED';
export const COPY_REVOKED_CODE = 'COPY_REVOKED';

export type CopyStatus = 'ACTIVE' | 'RETURNED' | 'REVOKED';

// Só o que este módulo usa do ORM: facilita simular o banco nos testes.
export interface CopyRow {
  id: number;
  researchId: number;
  deviceId: string;
  userId: number | null;
  active: boolean;
  createdAt: string;
  returnedAt?: string | null;
  revokedAt?: string | null;
  revokedById?: number | null;
  revokeReason?: string | null;
  unblockedAt?: string | null;
  unblockedById?: number | null;
}

/** `orm` = `prisma.client.orm.public` */
type Orm = any;

/** Situação de uma cópia baixada: ativa, devolvida ou revogada. */
export function copyStatus(copy: Pick<CopyRow, 'active' | 'revokedAt'>): CopyStatus {
  if (copy.active) return 'ACTIVE';
  return copy.revokedAt ? 'REVOKED' : 'RETURNED';
}

/** Mensagem de questionário travado, informando quantos aparelhos estão com a pesquisa baixada. */
export function lockedMessage(activeCopies: number): string {
  const quem = activeCopies === 1 ? '1 aparelho está' : `${activeCopies} aparelhos estão`;
  return (
    `Questionário travado: ${quem} com a pesquisa baixada. ` +
    'Não é possível incluir, excluir, reordenar ou alterar questões, opções, validações, regras de pulo ' +
    'ou a configuração de gravação até que todas as cópias sejam devolvidas ou revogadas.'
  );
}

export const CLOSED_MESSAGE = 'Pesquisa encerrada: o questionário não pode mais ser alterado.';

/** Erro 403 estruturado: a tela lê `message`; integrações leem `code` e `activeCopies`. */
export function lockedException(activeCopies: number) {
  return new ForbiddenException({
    statusCode: 403,
    code: RESEARCH_LOCKED_CODE,
    message: lockedMessage(activeCopies),
    activeCopies,
  });
}

/**
 * Cria o erro 403 usado quando o acesso de um aparelho foi revogado (o aplicativo não tenta de
 * novo).
 */
export function copyRevokedException(message = 'O acesso deste aparelho a esta pesquisa foi revogado pelo administrador.') {
  return new ForbiddenException({ statusCode: 403, code: COPY_REVOKED_CODE, message, retryable: false });
}

/** Conta as cópias ativas (aparelhos com a pesquisa baixada) de uma pesquisa. */
export async function countActiveCopies(orm: Orm, researchId: number): Promise<number> {
  const rows: CopyRow[] = await orm.ResearchDownload.where({ researchId, active: true }).all();
  return rows.length;
}

/** Quantas vezes a pesquisa foi baixada em algum aparelho (cópias ativas, devolvidas e revogadas). */
export async function countDownloads(orm: Orm, researchId: number): Promise<number> {
  const rows: CopyRow[] = await orm.ResearchDownload.where({ researchId }).all();
  return rows.length;
}

export interface LockState {
  locked: boolean;
  /** ACTIVE_COPIES: há cópia em campo. CLOSED: pesquisa encerrada (estado final). null: editável. */
  reason: 'ACTIVE_COPIES' | 'CLOSED' | null;
  activeCopies: number;
  message: string | null;
}

/** Diz se o questionário está travado e por quê: cópias ativas ou pesquisa encerrada. */
export async function getLockState(orm: Orm, research: { id: number; status: string }): Promise<LockState> {
  const activeCopies = await countActiveCopies(orm, research.id);
  if (activeCopies > 0) {
    return { locked: true, reason: 'ACTIVE_COPIES', activeCopies, message: lockedMessage(activeCopies) };
  }
  if (research.status === 'CLOSED') {
    return { locked: true, reason: 'CLOSED', activeCopies: 0, message: CLOSED_MESSAGE };
  }
  return { locked: false, reason: null, activeCopies: 0, message: null };
}

/** Lança 403 se a estrutura estiver travada (cópia ativa ou pesquisa encerrada). */
export async function assertStructureEditable(orm: Orm, research: { id: number; status: string }): Promise<void> {
  const state = await getLockState(orm, research);
  if (!state.locked) return;
  if (state.reason === 'ACTIVE_COPIES') throw lockedException(state.activeCopies);
  throw new ForbiddenException({ statusCode: 403, code: RESEARCH_LOCKED_CODE, message: CLOSED_MESSAGE, activeCopies: 0 });
}

/**
 * Registra o download. A chave da cópia é pesquisa + pesquisador + aparelho:
 *  - o MESMO aparelho baixando de novo (botão "atualizar") renova a própria cópia, não cria outra;
 *  - o mesmo pesquisador em OUTRO aparelho cria uma segunda cópia (conta duas).
 */
export async function registerCopy(
  orm: Orm,
  input: { researchId: number; userId: number; deviceId: string },
  now = new Date(),
): Promise<CopyRow> {
  const existing: CopyRow[] = await orm.ResearchDownload.where({
    researchId: input.researchId,
    userId: input.userId,
    deviceId: input.deviceId,
    active: true,
  }).all();

  if (existing.length > 0) {
    const [keep, ...duplicates] = existing;
    // Defesa contra downloads simultâneos do mesmo aparelho: sobra uma só.
    for (const extra of duplicates) {
      await orm.ResearchDownload.where({ id: extra.id }).update({ active: false, returnedAt: now.toISOString() });
    }
    return orm.ResearchDownload.where({ id: keep.id }).update({ createdAt: now.toISOString() });
  }

  return orm.ResearchDownload.create({
    researchId: input.researchId,
    deviceId: input.deviceId,
    userId: input.userId,
    active: true,
  });
}

/** O aparelho devolve a cópia. Devolver duas vezes não faz mal: a segunda não encontra cópia ativa. */
export async function returnCopy(
  orm: Orm,
  input: { researchId: number; userId: number; deviceId: string },
  now = new Date(),
): Promise<{ returned: boolean; copy: CopyRow | null }> {
  const active: CopyRow[] = await orm.ResearchDownload.where({
    researchId: input.researchId,
    userId: input.userId,
    deviceId: input.deviceId,
    active: true,
  }).all();

  let last: CopyRow | null = null;
  for (const copy of active) {
    last = await orm.ResearchDownload.where({ id: copy.id }).update({ active: false, returnedAt: now.toISOString() });
  }
  return { returned: active.length > 0, copy: last };
}

/** Revogação forçada: a cópia deixa de contar e o aparelho perde o acesso à pesquisa. */
export async function revokeCopy(
  orm: Orm,
  copy: CopyRow,
  input: { revokedById: number; reason?: string | null },
  now = new Date(),
): Promise<CopyRow> {
  return orm.ResearchDownload.where({ id: copy.id }).update({
    active: false,
    revokedAt: now.toISOString(),
    revokedById: input.revokedById,
    revokeReason: input.reason?.trim() || null,
  });
}

/**
 * O aparelho teve a cópia revogada para esta pesquisa? Vale para qualquer pesquisador logado nele:
 * é o aparelho que perde o acesso (extraviado, quebrado, em mãos erradas), não só a conta.
 */
export async function isDeviceRevoked(orm: Orm, researchId: number, deviceId: string | null | undefined): Promise<boolean> {
  if (!deviceId) return false;
  const rows: CopyRow[] = await orm.ResearchDownload.where({ researchId, deviceId, active: false }).all();
  // Revogação desbloqueada pelo administrador deixa de valer (fica só no histórico).
  return rows.some((row) => !!row.revokedAt && !row.unblockedAt);
}

/**
 * Desbloqueio do aparelho: o administrador desfaz a revogação. O registro da revogação é mantido e passa a
 * mostrar quem desbloqueou e quando; o aparelho volta a poder baixar a pesquisa (gerando uma cópia nova).
 */
export async function unblockDevice(
  orm: Orm,
  researchId: number,
  deviceId: string,
  input: { unblockedById: number },
  now = new Date(),
): Promise<number> {
  const rows: CopyRow[] = await orm.ResearchDownload.where({ researchId, deviceId, active: false }).all();
  const blocking = rows.filter((row) => !!row.revokedAt && !row.unblockedAt);
  for (const row of blocking) {
    await orm.ResearchDownload.where({ id: row.id }).update({
      unblockedAt: now.toISOString(),
      unblockedById: input.unblockedById,
    });
  }
  return blocking.length;
}

/** Situação da cópia de um pesquisador num aparelho (a mais recente), para o app saber se ainda vale. */
export async function copyStatusOf(
  orm: Orm,
  researchId: number,
  userId: number,
  deviceId: string,
): Promise<CopyStatus | null> {
  const rows: CopyRow[] = await orm.ResearchDownload.where({ researchId, userId, deviceId }).all();
  if (rows.length === 0) return null;
  if (rows.some((r) => r.active)) return 'ACTIVE';
  // Revogação vale mais que devolução anterior: o aparelho está bloqueado.
  if (await isDeviceRevoked(orm, researchId, deviceId)) return 'REVOKED';
  return 'RETURNED';
}

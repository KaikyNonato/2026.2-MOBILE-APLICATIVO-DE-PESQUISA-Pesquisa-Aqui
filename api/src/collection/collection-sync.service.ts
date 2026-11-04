import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { PrismaService } from '../prisma.service.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { assertValidConsent, CONSENT_REQUIRED } from './consent.js';
import { SyncCollectionItemDto, type SyncCollectionsDto } from './dto/sync-collections.dto.js';
import { COPY_REVOKED_CODE, isDeviceRevoked } from '../research/research-copies.js';

// Códigos de recusa que o aplicativo recebe, por coleta. `retryable` diz se vale tentar de novo:
// recusa definitiva sai da fila do aparelho; falha temporária continua nela.
export const SYNC_REJECTION = {
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  INVALID_DATES: 'INVALID_DATES',
  RESEARCH_NOT_FOUND: 'RESEARCH_NOT_FOUND',
  NOT_LINKED: 'NOT_LINKED',
  RESEARCH_CLOSED: 'RESEARCH_CLOSED',
  COPY_REVOKED: COPY_REVOKED_CODE,
  CONSENT_REQUIRED,
  QUESTION_NOT_FOUND: 'QUESTION_NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type SyncRejectionCode = (typeof SYNC_REJECTION)[keyof typeof SYNC_REJECTION];

export type SyncItemResult =
  | { index: number; clientId: string | null; status: 'ACCEPTED'; collectionId: number }
  | { index: number; clientId: string | null; status: 'ALREADY_EXISTS'; collectionId: number }
  | {
    index: number;
    clientId: string | null;
    status: 'REJECTED';
    code: SyncRejectionCode;
    reason: string;
    retryable: boolean;
    questionIds?: number[];
  };

interface ResearchContext {
  research: { id: number; title: string; status: string; companyId: number; recordInterview: boolean } | null;
  linked: boolean;
  // Carregado só quando alguma coleta do lote precisa conferir as questões.
  questionIds?: Set<number>;
}

/** Recebimento, em lote, das coletas guardadas na fila offline do aplicativo. */
@Injectable()
export class CollectionSyncService {
  private readonly logger = new Logger(CollectionSyncService.name);

  constructor(private prisma: PrismaService) { }

  /**
   * Recebe um lote de coletas guardadas no aparelho. Cada coleta é decidida sozinha:
   * uma recusa nunca derruba as outras, e o reenvio de uma coleta já recebida não a duplica.
   */
  async sync(dto: SyncCollectionsDto, currentUser: UserPayLoad) {
    if (currentUser.profile !== 'RESEARCHER') {
      throw new ForbiddenException('Somente pesquisadores enviam coletas.');
    }

    const orm = this.prisma.client.orm.public;

    // No token, `sub` é o username (não o id numérico)
    const user = await orm.User.where({ username: String(currentUser.sub) }).first();
    if (!user) throw new ForbiddenException('Usuário não encontrado.');

    const contexts = new Map<number, ResearchContext>();
    const results: SyncItemResult[] = [];

    // Em sequência (e não em paralelo): o mesmo UUID repetido dentro do lote vira "já existia" na segunda vez.
    for (const [index, raw] of dto.collections.entries()) {
      const clientId = echoClientId(raw);
      try {
        results.push(await this.processItem(index, raw, clientId, dto.deviceId, user, currentUser, contexts));
      } catch (error) {
        this.logger.error(`Falha ao gravar a coleta ${clientId ?? `#${index}`}: ${String(error)}`);
        results.push(
          rejected(index, clientId, SYNC_REJECTION.INTERNAL_ERROR, 'Não foi possível gravar esta coleta agora. Tente enviar novamente.', true),
        );
      }
    }

    const summary = {
      total: results.length,
      accepted: results.filter((r) => r.status === 'ACCEPTED').length,
      alreadyExisting: results.filter((r) => r.status === 'ALREADY_EXISTS').length,
      rejected: results.filter((r) => r.status === 'REJECTED').length,
    };

    // Log de sincronização: aparelho, horário (do servidor) e o resultado de cada coleta.
    // Se o log falhar, as coletas já estão gravadas: não derruba a resposta (o app apagaria a fila de menos).
    let syncLogId: number | null = null;
    let receivedAt = new Date().toISOString();
    try {
      const log = await orm.SyncLog.create({
        researcherId: user.id,
        deviceId: dto.deviceId,
        totalCount: summary.total,
        acceptedCount: summary.accepted,
        existingCount: summary.alreadyExisting,
        rejectedCount: summary.rejected,
        details: JSON.stringify(results),
      });
      syncLogId = log.id;
      receivedAt = log.receivedAt;
    } catch (error) {
      this.logger.error(`Não foi possível registrar o log de sincronização: ${String(error)}`);
    }

    return { syncLogId, deviceId: dto.deviceId, receivedAt, summary, results };
  }

  /**
   * Processa uma coleta do lote: valida, confere permissões e regras, grava e devolve o resultado
   * dela (aceita, já existente ou recusada).
   */
  private async processItem(
    index: number,
    raw: unknown,
    clientId: string | null,
    deviceId: string,
    user: { id: number },
    currentUser: UserPayLoad,
    contexts: Map<number, ResearchContext>,
  ): Promise<SyncItemResult> {
    const orm = this.prisma.client.orm.public;

    // 1. Formato da coleta (UUID, datas, respostas...) — só esta coleta é recusada.
    const parsed = await parseItem(raw);
    if (!parsed.ok) {
      return rejected(index, clientId, SYNC_REJECTION.INVALID_PAYLOAD, `Dados da coleta inválidos: ${parsed.fields.join(', ')}.`, false);
    }
    const item = parsed.item;
    const uuid = item.clientId.toLowerCase();

    // 2. Idempotência: o UUID já foi recebido deste pesquisador? Vem antes das regras da pesquisa,
    //    para que reenviar uma coleta antiga (mesmo de pesquisa depois encerrada) seja reconhecida e saia da fila.
    const existing = await orm.Collection.where({ researcherId: user.id, clientId: uuid }).first();
    if (existing) return { index, clientId, status: 'ALREADY_EXISTS', collectionId: existing.id };

    // 3. Pesquisa: existe, é da empresa do pesquisador, ele está vinculado e ela aceita coletas.
    const context = await this.contextFor(item.researchId, user.id, contexts);
    const research = context.research;
    if (!research || research.status === 'DRAFT' || research.companyId !== currentUser.companyId) {
      return rejected(index, clientId, SYNC_REJECTION.RESEARCH_NOT_FOUND, 'Pesquisa não encontrada.', false);
    }
    if (!context.linked) {
      return rejected(index, clientId, SYNC_REJECTION.NOT_LINKED, 'Você não está vinculado a esta pesquisa.', false);
    }
    if (research.status === 'CLOSED') {
      return rejected(
        index,
        clientId,
        SYNC_REJECTION.RESEARCH_CLOSED,
        `A pesquisa "${research.title}" está encerrada e não recebe mais coletas.`,
        false,
      );
    }

    // 3b. Aparelho com a cópia revogada pelo administrador: não entra coleta nova feita nele
    //     (a versão do formulário que ele guarda pode ter ficado para trás ou o aparelho estar extraviado).
    //     Coleta já recebida segue reconhecida no passo 2.
    if (await isDeviceRevoked(orm, research.id, deviceId)) {
      return rejected(
        index,
        clientId,
        SYNC_REJECTION.COPY_REVOKED,
        'O administrador revogou o acesso deste aparelho a esta pesquisa. A coleta não foi aceita.',
        false,
      );
    }

    // 4. Data e hora de início e fim.
    if (new Date(item.finishedAt) < new Date(item.startedAt)) {
      return rejected(index, clientId, SYNC_REJECTION.INVALID_DATES, 'O fim da coleta não pode ser anterior ao início.', false);
    }

    // 5. Consentimento: pesquisa que grava a entrevista só aceita coleta com o aceite registrado.
    let consentAt: Date | null = null;
    if (research.recordInterview) {
      try {
        consentAt = assertValidConsent(item.consent, item.startedAt);
      } catch (error) {
        if (error instanceof BadRequestException) {
          return rejected(index, clientId, SYNC_REJECTION.CONSENT_REQUIRED, messageOf(error), false);
        }
        throw error;
      }
    }

    // 6. Respostas de questões que não existem nesta pesquisa: recusa só esta coleta, e diz quais.
    const validIds = await this.questionIdsOf(research.id, context);
    const strayIds = [...new Set(item.answers.map((a) => a.questionId).filter((id) => !validIds.has(id)))];
    if (strayIds.length > 0) {
      return {
        ...rejected(
          index,
          clientId,
          SYNC_REJECTION.QUESTION_NOT_FOUND,
          `${strayIds.length === 1 ? 'A questão' : 'As questões'} ${strayIds.join(', ')} ${strayIds.length === 1 ? 'não pertence' : 'não pertencem'} a esta pesquisa.`,
          false,
        ),
        questionIds: strayIds,
      };
    }

    // 7. Grava a coleta e as respostas juntas: ou entra tudo, ou nada.
    try {
      const collection = await this.prisma.client.transaction(async (tx) => {
        const txOrm = tx.orm.public;
        const created = await txOrm.Collection.create({
          researchId: research.id,
          researcherId: user.id,
          deviceId,
          clientId: uuid,
          startedAt: new Date(item.startedAt).toISOString(),
          finishedAt: new Date(item.finishedAt).toISOString(),
          startLatitude: item.startLocation?.latitude ?? null,
          startLongitude: item.startLocation?.longitude ?? null,
          locationAccuracy: item.startLocation?.accuracy ?? null,
          consentGiven: consentAt !== null,
          consentAt: consentAt ? consentAt.toISOString() : null,
          // quem confirmou o aceite: o pesquisador autenticado, nunca um valor enviado pelo aparelho
          consentConfirmedById: consentAt ? user.id : null,
          audioPath: null,
          audioMimeType: null,
          audioSizeBytes: null,
          audioDurationSeconds: null,
        });
        for (const answer of item.answers) {
          await txOrm.Answer.create({
            questionId: answer.questionId,
            value: answer.value,
            collectionId: created.id,
          });
        }
        return created;
      });
      return { index, clientId, status: 'ACCEPTED', collectionId: collection.id };
    } catch (error) {
      // Corrida: outro envio do mesmo UUID gravou entre a checagem (passo 2) e agora
      // (o índice único barra a segunda gravação). Reconhece a que ficou em vez de duplicar.
      const winner = await orm.Collection.where({ researcherId: user.id, clientId: uuid }).first();
      if (winner) return { index, clientId, status: 'ALREADY_EXISTS', collectionId: winner.id };
      throw error;
    }
  }

  /** Pesquisa, vínculo do pesquisador e (depois) questões, lidos uma vez por lote. */
  private async contextFor(researchId: number, userId: number, contexts: Map<number, ResearchContext>) {
    const cached = contexts.get(researchId);
    if (cached) return cached;

    const orm = this.prisma.client.orm.public;
    const research = await orm.Research.where({ id: researchId }).first();
    const link = research ? await orm.ResearchResearcher.where({ researchId, userId }).first() : null;

    const context: ResearchContext = {
      research: research
        ? {
          id: research.id,
          title: research.title,
          status: research.status,
          companyId: research.companyId,
          recordInterview: research.recordInterview,
        }
        : null,
      linked: !!link,
    };
    contexts.set(researchId, context);
    return context;
  }

  /** Ids das questões da pesquisa, guardados no contexto para não consultar de novo a cada coleta. */
  private async questionIdsOf(researchId: number, context: ResearchContext) {
    if (context.questionIds) return context.questionIds;

    const orm = this.prisma.client.orm.public;
    const ids = new Set<number>();
    for (const section of await orm.Section.where({ researchId }).all()) {
      for (const question of await orm.Question.where({ sectionId: section.id }).all()) {
        ids.add(question.id);
      }
    }
    context.questionIds = ids;
    return ids;
  }
}

/** Monta o resultado de uma coleta recusada, com código, motivo e se vale tentar de novo. */
function rejected(
  index: number,
  clientId: string | null,
  code: SyncRejectionCode,
  reason: string,
  retryable: boolean,
): Extract<SyncItemResult, { status: 'REJECTED' }> {
  return { index, clientId, status: 'REJECTED', code, reason, retryable };
}

/**
 * O identificador como o aparelho mandou, para ele casar a resposta com a coleta da fila — mesmo se
 * a coleta for recusada.
 */
function echoClientId(raw: unknown): string | null {
  if (raw && typeof raw === 'object' && typeof (raw as { clientId?: unknown }).clientId === 'string') {
    return (raw as { clientId: string }).clientId.slice(0, 100);
  }
  return null;
}

/** Valida o formato de uma coleta recebida. Se for inválida, lista os campos com problema. */
async function parseItem(
  raw: unknown,
): Promise<{ ok: true; item: SyncCollectionItemDto } | { ok: false; fields: string[] }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, fields: ['coleta'] };

  const item = plainToInstance(SyncCollectionItemDto, raw);
  const errors = await validate(item, { whitelist: true });
  if (errors.length > 0) return { ok: false, fields: invalidFields(errors) };
  return { ok: true, item };
}

/** Percorre os erros de validação e devolve o caminho de cada campo inválido. */
function invalidFields(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    return [...(error.constraints ? [path] : []), ...invalidFields(error.children ?? [], path)];
  });
}

/** Extrai o texto da mensagem de um erro 400. */
function messageOf(error: BadRequestException): string {
  const body = error.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: string | string[] }).message;
  return Array.isArray(message) ? message.join(' ') : (message ?? error.message);
}

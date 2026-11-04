import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { CollectionSyncService } from './collection-sync.service';
import { SyncCollectionsDto } from './dto/sync-collections.dto';

type Row = Record<string, any>;

/**
 * Banco em memória, só o suficiente para a sincronização: respeita o índice único
 * (pesquisador + UUID) da coleta e desfaz a transação inteira se algo falhar dentro dela.
 */
function makeDb() {
  let tables: Record<string, Row[]> = {
    User: [
      { id: 1, name: 'Paula', username: 'paula', profile: 'RESEARCHER', companyId: 10 },
      { id: 2, name: 'Admin', username: 'admin', profile: 'ADMINISTRATOR', companyId: 10 },
    ],
    Research: [
      { id: 5, title: 'Satisfação', companyId: 10, status: 'IN_FIELD', recordInterview: false },
      { id: 6, title: 'Pesquisa antiga', companyId: 10, status: 'CLOSED', recordInterview: false },
      { id: 7, title: 'Com gravação', companyId: 10, status: 'IN_FIELD', recordInterview: true },
      { id: 8, title: 'Rascunho', companyId: 10, status: 'DRAFT', recordInterview: false },
      { id: 9, title: 'De outra empresa', companyId: 99, status: 'IN_FIELD', recordInterview: false },
      { id: 11, title: 'Sem vínculo', companyId: 10, status: 'IN_FIELD', recordInterview: false },
    ],
    ResearchResearcher: [5, 6, 7, 8, 9].map((researchId, i) => ({ id: i + 1, researchId, userId: 1 })),
    Section: [
      { id: 50, researchId: 5 },
      { id: 60, researchId: 6 },
      { id: 70, researchId: 7 },
      { id: 110, researchId: 11 },
    ],
    Question: [
      { id: 100, sectionId: 50 },
      { id: 101, sectionId: 50 },
      { id: 600, sectionId: 60 },
      { id: 700, sectionId: 70 },
      { id: 1100, sectionId: 110 },
    ],
    Collection: [],
    Answer: [],
    SyncLog: [],
    ResearchDownload: [],
  };
  let nextId = 1;
  let activeSnapshot: typeof tables | null = null;
  const hooks = {
    beforeCollectionCreate: undefined as undefined | (() => void),
    failAnswerCreate: false,
    failSyncLogCreate: false,
  };

  const model = (name: string) => ({
    where: (filter: Row) => {
      const match = () => tables[name].filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v));
      return {
        first: async () => match()[0] ?? null,
        all: async () => match(),
      };
    },
    create: async (data: Row) => {
      if (name === 'Collection') hooks.beforeCollectionCreate?.();
      if (name === 'Answer' && hooks.failAnswerCreate) throw new Error('falha ao gravar a resposta');
      if (name === 'SyncLog' && hooks.failSyncLogCreate) throw new Error('falha ao gravar o log');
      if (
        name === 'Collection' &&
        data.clientId != null &&
        tables.Collection.some((c) => c.researcherId === data.researcherId && c.clientId === data.clientId)
      ) {
        throw new Error('duplicate key value violates unique constraint');
      }
      const row = { id: nextId++, receivedAt: '2026-10-10T15:00:00.000Z', ...data };
      tables[name].push(row);
      return row;
    },
  });
  const orm = { public: new Proxy({}, { get: (_t, name: string) => model(name) }) };
  const client = {
    orm,
    transaction: async (fn: (tx: { orm: typeof orm }) => Promise<any>) => {
      const snapshot = structuredClone(tables);
      activeSnapshot = snapshot;
      try {
        return await fn({ orm });
      } catch (error) {
        tables = snapshot; // desfaz tudo o que a transação gravou
        throw error;
      } finally {
        activeSnapshot = null;
      }
    },
  };
  // Gravação de OUTRA conexão, já confirmada: sobrevive ao rollback da transação em andamento.
  const commitFromAnotherConnection = (name: string, row: Row) => {
    tables[name].push(row);
    activeSnapshot?.[name].push(structuredClone(row));
  };
  return { db: { get tables() { return tables; } }, hooks, commitFromAnotherConnection, prisma: { client } as any };
}

const researcher = { sub: 'paula', username: 'paula', profile: 'RESEARCHER', companyId: 10 } as any;
const admin = { sub: 'admin', username: 'admin', profile: 'ADMINISTRATOR', companyId: 10 } as any;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (n: number, extra: Row = {}) => ({
  clientId: uuid(n),
  researchId: 5,
  startedAt: '2026-10-10T14:00:00.000Z',
  finishedAt: '2026-10-10T14:10:00.000Z',
  answers: [{ questionId: 100, value: 'sim' }],
  ...extra,
});
const batch = (collections: unknown[], deviceId = 'aparelho-1') => ({ deviceId, collections }) as any;

function setup() {
  const env = makeDb();
  return { ...env, service: new CollectionSyncService(env.prisma) };
}

describe('CollectionSyncService.sync', () => {
  it('aceita o lote, grava as coletas com data e hora de início e fim, e informa cada uma', async () => {
    const { db, service } = setup();
    const response = await service.sync(batch([item(1), item(2, { answers: [] })]), researcher);

    expect(response.summary).toEqual({ total: 2, accepted: 2, alreadyExisting: 0, rejected: 0 });
    expect(response.results).toEqual([
      { index: 0, clientId: uuid(1), status: 'ACCEPTED', collectionId: expect.any(Number) },
      { index: 1, clientId: uuid(2), status: 'ACCEPTED', collectionId: expect.any(Number) },
    ]);

    expect(db.tables.Collection).toHaveLength(2);
    const saved = db.tables.Collection[0];
    expect(saved.startedAt).toBe('2026-10-10T14:00:00.000Z');
    expect(saved.finishedAt).toBe('2026-10-10T14:10:00.000Z');
    expect(saved.researcherId).toBe(1);
    expect(saved.deviceId).toBe('aparelho-1');
    expect(saved.clientId).toBe(uuid(1));
    expect(db.tables.Answer).toEqual([expect.objectContaining({ questionId: 100, value: 'sim', collectionId: saved.id })]);
  });

  it('grava a data e a hora com o fuso informado, normalizadas em UTC', async () => {
    const { db, service } = setup();
    await service.sync(
      batch([item(1, { startedAt: '2026-10-10T11:00:00-03:00', finishedAt: '2026-10-10T11:25:30-03:00' })]),
      researcher,
    );
    expect(db.tables.Collection[0].startedAt).toBe('2026-10-10T14:00:00.000Z');
    expect(db.tables.Collection[0].finishedAt).toBe('2026-10-10T14:25:30.000Z');
  });

  describe('idempotência pelo UUID', () => {
    it('reenviar o mesmo lote reconhece as coletas e não duplica nada', async () => {
      const { db, service } = setup();
      const first = await service.sync(batch([item(1), item(2)]), researcher);
      const again = await service.sync(batch([item(1), item(2)]), researcher);

      expect(again.summary).toEqual({ total: 2, accepted: 0, alreadyExisting: 2, rejected: 0 });
      expect(again.results.map((r: any) => r.status)).toEqual(['ALREADY_EXISTS', 'ALREADY_EXISTS']);
      expect(again.results.map((r: any) => r.collectionId)).toEqual(first.results.map((r: any) => r.collectionId));
      expect(db.tables.Collection).toHaveLength(2);
      expect(db.tables.Answer).toHaveLength(2);
    });

    it('lote misto: grava só a coleta nova e reconhece a que já existia', async () => {
      const { db, service } = setup();
      await service.sync(batch([item(1)]), researcher);
      const response = await service.sync(batch([item(1), item(2)]), researcher);

      expect(response.results.map((r: any) => r.status)).toEqual(['ALREADY_EXISTS', 'ACCEPTED']);
      expect(db.tables.Collection).toHaveLength(2);
    });

    it('o mesmo UUID repetido dentro do lote vale uma coleta só', async () => {
      const { db, service } = setup();
      const response = await service.sync(batch([item(1), item(1)]), researcher);

      expect(response.results.map((r: any) => r.status)).toEqual(['ACCEPTED', 'ALREADY_EXISTS']);
      expect(db.tables.Collection).toHaveLength(1);
    });

    it('UUID em maiúsculas é o mesmo UUID', async () => {
      const { db, service } = setup();
      await service.sync(batch([item(1)]), researcher);
      const response = await service.sync(batch([item(1, { clientId: uuid(1).toUpperCase() })]), researcher);

      expect(response.results[0]).toMatchObject({ status: 'ALREADY_EXISTS', clientId: uuid(1).toUpperCase() });
      expect(db.tables.Collection).toHaveLength(1);
    });

    it('coleta já recebida continua reconhecida mesmo que a pesquisa tenha sido encerrada depois', async () => {
      const { db, service } = setup();
      await service.sync(batch([item(1)]), researcher);
      db.tables.Research.find((r) => r.id === 5)!.status = 'CLOSED';

      const response = await service.sync(batch([item(1)]), researcher);
      expect(response.results[0]).toMatchObject({ status: 'ALREADY_EXISTS' });
    });

    it('dois envios simultâneos do mesmo UUID: o que perde a corrida recebe "já existia", sem duplicar', async () => {
      const { db, hooks, commitFromAnotherConnection, service } = setup();
      hooks.beforeCollectionCreate = () => {
        // outro envio gravou a mesma coleta entre a checagem e a gravação
        hooks.beforeCollectionCreate = undefined;
        commitFromAnotherConnection('Collection', { id: 900, researcherId: 1, clientId: uuid(1), researchId: 5 });
      };

      const response = await service.sync(batch([item(1)]), researcher);
      expect(response.results[0]).toEqual({ index: 0, clientId: uuid(1), status: 'ALREADY_EXISTS', collectionId: 900 });
      expect(db.tables.Collection).toHaveLength(1);
      expect(db.tables.Answer).toHaveLength(0);
    });

    it('o UUID de um pesquisador não bloqueia o de outro', async () => {
      const { db, service } = setup();
      db.tables.Collection.push({ id: 800, researcherId: 77, clientId: uuid(1), researchId: 5 });

      const response = await service.sync(batch([item(1)]), researcher);
      expect(response.results[0]).toMatchObject({ status: 'ACCEPTED' });
    });
  });

  describe('recusas, coleta por coleta', () => {
    it('pesquisa encerrada: recusa com motivo claro e as demais coletas do lote seguem', async () => {
      const { db, service } = setup();
      const response = await service.sync(
        batch([item(1), item(2, { researchId: 6, answers: [{ questionId: 600, value: 'x' }] }), item(3)]),
        researcher,
      );

      expect(response.results.map((r: any) => r.status)).toEqual(['ACCEPTED', 'REJECTED', 'ACCEPTED']);
      expect(response.results[1]).toEqual({
        index: 1,
        clientId: uuid(2),
        status: 'REJECTED',
        code: 'RESEARCH_CLOSED',
        reason: 'A pesquisa "Pesquisa antiga" está encerrada e não recebe mais coletas.',
        retryable: false,
      });
      expect(response.summary).toEqual({ total: 3, accepted: 2, alreadyExisting: 0, rejected: 1 });
      expect(db.tables.Collection.map((c) => c.clientId)).toEqual([uuid(1), uuid(3)]);
    });

    it('resposta de questão inexistente recusa só aquela coleta, diz quais questões e não grava nada dela', async () => {
      const { db, service } = setup();
      const response = await service.sync(
        batch([
          item(1),
          item(2, { answers: [{ questionId: 100, value: 'a' }, { questionId: 999, value: 'b' }, { questionId: 888, value: 'c' }] }),
          item(3, { answers: [{ questionId: 600, value: 'de outra pesquisa' }] }),
          item(4),
        ]),
        researcher,
      );

      expect(response.results.map((r: any) => r.status)).toEqual(['ACCEPTED', 'REJECTED', 'REJECTED', 'ACCEPTED']);
      expect(response.results[1]).toMatchObject({
        code: 'QUESTION_NOT_FOUND',
        questionIds: [999, 888],
        reason: 'As questões 999, 888 não pertencem a esta pesquisa.',
        retryable: false,
      });
      // questão que existe, mas em outra pesquisa, também não vale
      expect(response.results[2]).toMatchObject({ code: 'QUESTION_NOT_FOUND', questionIds: [600] });
      expect(db.tables.Collection.map((c) => c.clientId)).toEqual([uuid(1), uuid(4)]);
      expect(db.tables.Answer).toHaveLength(2); // só as respostas das duas aceitas
    });

    it('coleta malformada é recusada sozinha, ecoando o identificador que o aparelho mandou', async () => {
      const { db, service } = setup();
      const response = await service.sync(
        batch([
          item(1, { startedAt: 'ontem' }),
          { ...item(2), clientId: 'nao-e-uuid' },
          null,
          'texto solto',
          item(3, { answers: [{ questionId: 'x', value: 1 }] }),
          item(4),
        ]),
        researcher,
      );

      expect(response.results.map((r: any) => r.status)).toEqual([
        'REJECTED',
        'REJECTED',
        'REJECTED',
        'REJECTED',
        'REJECTED',
        'ACCEPTED',
      ]);
      expect(response.results[0]).toMatchObject({
        clientId: uuid(1),
        code: 'INVALID_PAYLOAD',
        retryable: false,
        reason: 'Dados da coleta inválidos: startedAt.',
      });
      expect(response.results[1]).toMatchObject({ clientId: 'nao-e-uuid', code: 'INVALID_PAYLOAD' });
      expect(response.results[2]).toMatchObject({ clientId: null, code: 'INVALID_PAYLOAD' });
      expect((response.results[4] as any).reason).toContain('answers.0.questionId');
      expect(db.tables.Collection).toHaveLength(1);
    });

    it('fim da coleta anterior ao início é recusado', async () => {
      const { service } = setup();
      const response = await service.sync(
        batch([item(1, { startedAt: '2026-10-10T14:10:00.000Z', finishedAt: '2026-10-10T14:00:00.000Z' })]),
        researcher,
      );
      expect(response.results[0]).toMatchObject({ status: 'REJECTED', code: 'INVALID_DATES', retryable: false });
    });

    it('pesquisa que grava a entrevista exige o consentimento; com ele a coleta entra e registra quem confirmou', async () => {
      const { db, service } = setup();
      const research7 = { researchId: 7, answers: [{ questionId: 700, value: 'ok' }] };
      const response = await service.sync(
        batch([
          item(1, research7),
          item(2, { ...research7, consent: { accepted: true, acceptedAt: '2026-10-10T13:59:00.000Z' } }),
        ]),
        researcher,
      );

      expect(response.results[0]).toMatchObject({ status: 'REJECTED', code: 'CONSENT_REQUIRED', retryable: false });
      expect((response.results[0] as any).reason).toContain('consentimento');
      expect(response.results[1]).toMatchObject({ status: 'ACCEPTED' });
      expect(db.tables.Collection).toHaveLength(1);
      expect(db.tables.Collection[0]).toMatchObject({
        consentGiven: true,
        consentAt: '2026-10-10T13:59:00.000Z',
        consentConfirmedById: 1,
      });
    });

    it('pesquisa inexistente, de rascunho ou de outra empresa: "não encontrada"; sem vínculo: recusada', async () => {
      const { service } = setup();
      const response = await service.sync(
        batch([
          item(1, { researchId: 404 }),
          item(2, { researchId: 8 }),
          item(3, { researchId: 9 }),
          item(4, { researchId: 11, answers: [{ questionId: 1100, value: 'x' }] }),
        ]),
        researcher,
      );

      expect(response.results.map((r: any) => r.code)).toEqual([
        'RESEARCH_NOT_FOUND',
        'RESEARCH_NOT_FOUND',
        'RESEARCH_NOT_FOUND',
        'NOT_LINKED',
      ]);
    });

    it('aparelho com a cópia revogada pelo administrador: coleta nova é recusada (definitivo); outro aparelho segue', async () => {
      const { db, service } = setup();
      db.tables.ResearchDownload.push({
        id: 1, researchId: 5, userId: 1, deviceId: 'aparelho-perdido',
        active: false, revokedAt: '2026-10-10T12:00:00.000Z', revokedById: 2,
      });

      const revoked = await service.sync(batch([item(1)], 'aparelho-perdido'), researcher);
      expect(revoked.results[0]).toMatchObject({ status: 'REJECTED', code: 'COPY_REVOKED', retryable: false });
      expect(db.tables.Collection).toHaveLength(0);

      // a revogação é do aparelho nessa pesquisa: o mesmo pesquisador em outro aparelho continua enviando
      const other = await service.sync(batch([item(2)], 'aparelho-novo'), researcher);
      expect(other.results[0]).toMatchObject({ status: 'ACCEPTED' });
    });

    it('cópia apenas devolvida (não revogada) não bloqueia o aparelho', async () => {
      const { db, service } = setup();
      db.tables.ResearchDownload.push({
        id: 1, researchId: 5, userId: 1, deviceId: 'aparelho-1',
        active: false, returnedAt: '2026-10-10T12:00:00.000Z',
      });
      const response = await service.sync(batch([item(1)]), researcher);
      expect(response.results[0]).toMatchObject({ status: 'ACCEPTED' });
    });

    it('coleta já recebida antes da revogação continua reconhecida (não é recusada nem duplicada)', async () => {
      const { db, service } = setup();
      await service.sync(batch([item(1)], 'aparelho-perdido'), researcher);
      db.tables.ResearchDownload.push({
        id: 1, researchId: 5, userId: 1, deviceId: 'aparelho-perdido',
        active: false, revokedAt: '2026-10-10T12:00:00.000Z', revokedById: 2,
      });
      const again = await service.sync(batch([item(1)], 'aparelho-perdido'), researcher);
      expect(again.results[0]).toMatchObject({ status: 'ALREADY_EXISTS' });
      expect(db.tables.Collection).toHaveLength(1);
    });
  });

  describe('falha ao gravar', () => {
    it('desfaz a coleta inteira, marca como tentar de novo e deixa o resto do lote seguir', async () => {
      const { db, hooks, service } = setup();
      hooks.failAnswerCreate = true;

      const response = await service.sync(batch([item(1), item(2, { answers: [] })]), researcher);

      expect(response.results[0]).toMatchObject({ status: 'REJECTED', code: 'INTERNAL_ERROR', retryable: true });
      expect(response.results[1]).toMatchObject({ status: 'ACCEPTED' });
      expect(db.tables.Collection.map((c) => c.clientId)).toEqual([uuid(2)]); // nada pela metade

      // o aparelho tenta de novo e agora entra
      hooks.failAnswerCreate = false;
      const retry = await service.sync(batch([item(1)]), researcher);
      expect(retry.results[0]).toMatchObject({ status: 'ACCEPTED' });
      expect(db.tables.Answer).toHaveLength(1);
    });
  });

  describe('log de sincronização', () => {
    it('registra o envio com o aparelho, o horário e o resultado de cada coleta', async () => {
      const { db, service } = setup();
      const response = await service.sync(batch([item(1), item(2, { researchId: 6 })], 'pixel-7'), researcher);

      expect(db.tables.SyncLog).toHaveLength(1);
      const log = db.tables.SyncLog[0];
      expect(log).toMatchObject({
        researcherId: 1,
        deviceId: 'pixel-7',
        totalCount: 2,
        acceptedCount: 1,
        existingCount: 0,
        rejectedCount: 1,
      });
      expect(JSON.parse(log.details)).toEqual(response.results);
      expect(response).toMatchObject({
        syncLogId: log.id,
        deviceId: 'pixel-7',
        receivedAt: '2026-10-10T15:00:00.000Z',
      });
    });

    it('registra também o envio em que tudo já existia', async () => {
      const { db, service } = setup();
      await service.sync(batch([item(1)]), researcher);
      await service.sync(batch([item(1)]), researcher);

      expect(db.tables.SyncLog).toHaveLength(2);
      expect(db.tables.SyncLog[1]).toMatchObject({ totalCount: 1, acceptedCount: 0, existingCount: 1, rejectedCount: 0 });
    });

    it('se o log falhar, a resposta ainda diz o que foi gravado', async () => {
      const { db, hooks, service } = setup();
      hooks.failSyncLogCreate = true;

      const response = await service.sync(batch([item(1)]), researcher);
      expect(response.syncLogId).toBeNull();
      expect(response.results[0]).toMatchObject({ status: 'ACCEPTED' });
      expect(db.tables.Collection).toHaveLength(1);
    });
  });

  it('só pesquisador envia coletas', async () => {
    const { db, service } = setup();
    await expect(service.sync(batch([item(1)]), admin)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.Collection).toHaveLength(0);
    expect(db.tables.SyncLog).toHaveLength(0);
  });
});

describe('SyncCollectionsDto (validação do lote)', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const run = (body: unknown) => pipe.transform(body, { type: 'body', metatype: SyncCollectionsDto });

  it('deixa passar uma coleta malformada: quem decide é o serviço, coleta por coleta', async () => {
    const dto = await run({ deviceId: 'a', collections: [item(1), { lixo: true }] });
    expect(dto.collections).toHaveLength(2);
  });

  it('recusa lote sem aparelho, vazio ou grande demais', async () => {
    await expect(run({ collections: [item(1)] })).rejects.toBeDefined();
    await expect(run({ deviceId: 'a', collections: [] })).rejects.toBeDefined();
    await expect(run({ deviceId: 'a', collections: Array.from({ length: 101 }, (_, i) => item(i + 1)) })).rejects.toBeDefined();
    await expect(run({ deviceId: 'a', collections: 'nada' })).rejects.toBeDefined();
  });
});

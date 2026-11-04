import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ResearchService } from './research.service.js';
import { SectionService } from '../section/section.service.js';
import { QuestionService } from '../question/question.service.js';
import { QuestionRuleService } from '../question-rule/question-rule.service.js';

// Evita carregar o cliente do banco (ESM) e o armazenamento de mídia: aqui o banco é simulado em memória.
jest.mock('../prisma.service.js', () => ({ PrismaService: class { } }));
jest.mock('../collection/audio-storage.js', () => ({ AudioStorage: class { } }));

// W11 — o questionário trava enquanto houver celular com a pesquisa baixada.
// Os serviços de verdade (pesquisa, seção, questão, regra) rodam sobre tabelas em memória.

const NOW = '2026-10-10T15:00:00.000Z';

function fakePrisma(db: Record<string, any[]>) {
  let nextId = 1000;
  const defaults: Record<string, () => object> = {
    ResearchDownload: () => ({ active: true, createdAt: new Date().toISOString() }),
  };
  const table = (name: string) => ({
    where: (filter: Record<string, unknown>) => {
      const match = () => db[name].filter((row) => Object.entries(filter).every(([k, v]) => row[k] === v));
      return {
        first: async () => match()[0] ?? null,
        all: async () => match(),
        update: async (data: object) => {
          const [row] = match();
          Object.assign(row, data);
          return row;
        },
        delete: async () => {
          const rows = match();
          db[name] = db[name].filter((r) => !rows.includes(r));
          return rows[0] ?? null;
        },
      };
    },
    create: async (data: object) => {
      const row = { id: nextId++, ...(defaults[name]?.() ?? {}), ...data };
      db[name].push(row);
      return row;
    },
    all: async () => db[name],
  });
  const orm = { public: Object.fromEntries(Object.keys(db).map((n) => [n, table(n)])) };
  return { client: { orm } } as any;
}

const admin = { sub: 'adm', profile: 'ADMINISTRATOR', companyId: 1 } as any;
const otherAdmin = { sub: 'adm2', profile: 'ADMINISTRATOR', companyId: 2 } as any;
const ana = { sub: 'ana', profile: 'RESEARCHER', companyId: 1 } as any;
const bruno = { sub: 'bruno', profile: 'RESEARCHER', companyId: 1 } as any;

function setup(researchStatus = 'PUBLISHED') {
  const db: Record<string, any[]> = {
    User: [
      { id: 1, name: 'Adm', username: 'adm', profile: 'ADMINISTRATOR', companyId: 1, situation: 'ACTIVE' },
      { id: 2, name: 'Ana', username: 'ana', profile: 'RESEARCHER', companyId: 1, situation: 'ACTIVE' },
      { id: 3, name: 'Bruno', username: 'bruno', profile: 'RESEARCHER', companyId: 1, situation: 'ACTIVE' },
      { id: 4, name: 'Adm 2', username: 'adm2', profile: 'ADMINISTRATOR', companyId: 2, situation: 'ACTIVE' },
    ],
    Research: [
      {
        id: 10, title: 'Satisfação', status: researchStatus, companyId: 1, recordInterview: false,
        startDate: '2020-01-01', endDate: '2999-12-31',
      },
    ],
    ResearchResearcher: [
      { id: 1, researchId: 10, userId: 2, targetCount: 50 },
      { id: 2, researchId: 10, userId: 3, targetCount: 20 },
    ],
    Section: [{ id: 20, researchId: 10, title: 'Bloco 1', order: 1 }],
    Question: [
      { id: 30, sectionId: 20, statement: 'Gostou?', type: 'YES_NO', order: 1 },
      { id: 31, sectionId: 20, statement: 'Por quê?', type: 'FREE_TEXT', order: 2 },
      { id: 32, sectionId: 20, statement: 'Nota?', type: 'SCALE_1_5', order: 3 },
    ],
    QuestionOption: [{ id: 40, questionId: 30, text: 'Sim', order: 1 }],
    QuestionRule: [],
    Collection: [],
    ResearchDownload: [],
  };
  const prisma = fakePrisma(db);
  const research = new ResearchService(prisma, { removeDir: jest.fn() } as any);
  const rules = new QuestionRuleService(prisma, research);
  const sections = new SectionService(prisma, research, rules);
  const questions = new QuestionService(prisma, sections, rules, research);
  return { db, research, rules, sections, questions };
}

const LOCKED = expect.objectContaining({ response: expect.objectContaining({ code: 'RESEARCH_LOCKED' }) });

describe('W11 — cópia ativa trava o questionário', () => {
  describe('1. o download registra a cópia ativa com pesquisador, aparelho e data', () => {
    it('grava pesquisador, aparelho e data, e informa a cópia no pacote', async () => {
      const { db, research } = setup();
      const pkg = await research.downloadPackage(10, 'aparelho-A', ana);

      expect(db.ResearchDownload).toHaveLength(1);
      expect(db.ResearchDownload[0]).toMatchObject({ researchId: 10, userId: 2, deviceId: 'aparelho-A', active: true });
      expect(db.ResearchDownload[0].createdAt).toEqual(expect.any(String));
      expect(pkg.download).toMatchObject({ deviceId: 'aparelho-A', downloadedAt: db.ResearchDownload[0].createdAt });
    });

    it('o primeiro download de pesquisa publicada a coloca em campo', async () => {
      const { db, research } = setup('PUBLISHED');
      await research.downloadPackage(10, 'aparelho-A', ana);
      expect(db.Research[0].status).toBe('IN_FIELD');
    });
  });

  describe('2. com cópia ativa, mexer na estrutura é recusado pela API', () => {
    async function withActiveCopy() {
      const env = setup('IN_FIELD');
      await env.research.downloadPackage(10, 'aparelho-A', ana);
      return env;
    }

    it('seção: incluir, alterar, reordenar e excluir', async () => {
      const { sections } = await withActiveCopy();
      await expect(sections.create({ researchId: 10, title: 'Novo', order: 2 } as any, admin)).rejects.toEqual(LOCKED);
      await expect(sections.update(20, { title: 'Outro' } as any, admin)).rejects.toEqual(LOCKED);
      await expect(sections.reorder({ researchId: 10, orderedIds: [20] } as any, admin)).rejects.toEqual(LOCKED);
      await expect(sections.delete(20, admin)).rejects.toEqual(LOCKED);
    });

    it('questão: incluir, alterar (inclui validação e ordem), reordenar e excluir', async () => {
      const { questions, db } = await withActiveCopy();
      const before = JSON.stringify(db.Question);

      await expect(questions.create({ sectionId: 20, statement: 'N', type: 'FREE_TEXT', order: 4 } as any, admin)).rejects.toEqual(LOCKED);
      await expect(questions.update(31, { statement: 'Mudou' } as any, admin)).rejects.toEqual(LOCKED);
      await expect(questions.update(31, { isRequired: true, maxLength: 10 } as any, admin)).rejects.toEqual(LOCKED); // validação
      await expect(questions.update(31, { order: 1 } as any, admin)).rejects.toEqual(LOCKED); // ordem
      await expect(questions.update(31, { maxFiles: 2, maxDuration: 30 } as any, admin)).rejects.toEqual(LOCKED); // gravação da questão
      await expect(questions.reorder({ sectionId: 20, orderedIds: [32, 31, 30] } as any, admin)).rejects.toEqual(LOCKED);
      await expect(questions.delete(31, admin)).rejects.toEqual(LOCKED);

      expect(JSON.stringify(db.Question)).toBe(before); // nada mudou no banco
    });

    it('opção: incluir, alterar e excluir', async () => {
      const { questions, db } = await withActiveCopy();
      await expect(questions.createOption(30, 'Não', 2, admin)).rejects.toEqual(LOCKED);
      await expect(questions.updateOption(40, admin, 'Talvez')).rejects.toEqual(LOCKED);
      await expect(questions.deleteOption(40, admin)).rejects.toEqual(LOCKED);
      expect(db.QuestionOption).toEqual([{ id: 40, questionId: 30, text: 'Sim', order: 1 }]);
    });

    it('regra de pulo: incluir e excluir', async () => {
      const { rules, db } = await withActiveCopy();
      db.QuestionRule.push({ id: 50, researchId: 10, sourceQuestionId: 30, triggerValue: 'true', targetQuestionId: 31 });

      await expect(
        rules.create({ sourceQuestionId: 30, triggerValue: 'false', targetQuestionId: 32 } as any, admin),
      ).rejects.toEqual(LOCKED);
      await expect(rules.delete(50, admin)).rejects.toEqual(LOCKED);
      expect(db.QuestionRule).toHaveLength(1);
    });

    it('configuração de gravação da entrevista: não liga nem desliga; repetir o valor atual é aceito', async () => {
      const { research, db } = await withActiveCopy();
      await expect(research.update(10, { recordInterview: true }, admin)).rejects.toEqual(LOCKED);
      expect(db.Research[0].recordInterview).toBe(false);

      await expect(research.update(10, { recordInterview: false, title: 'Novo título' }, admin)).resolves.toBeDefined();
    });

    it('a recusa explica o motivo e quantas cópias estão em campo', async () => {
      const { sections, research } = await withActiveCopy();
      await research.downloadPackage(10, 'aparelho-B', bruno);

      const error: any = await sections.create({ researchId: 10, title: 'N', order: 2 } as any, admin).catch((e) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toMatchObject({
        statusCode: 403,
        code: 'RESEARCH_LOCKED',
        activeCopies: 2,
        message: expect.stringContaining('2 aparelhos'),
      });
    });
  });

  describe('3. a tela mostra o motivo da trava e a lista de quem está com a pesquisa', () => {
    it('o detalhe traz locked, motivo e contador', async () => {
      const { research } = setup('IN_FIELD');
      expect(await research.findOneWithLock(10, admin)).toMatchObject({ locked: false, lockReason: null, activeCopies: 0 });

      await research.downloadPackage(10, 'aparelho-A', ana);
      expect(await research.findOneWithLock(10, admin)).toMatchObject({
        locked: true,
        lockReason: 'ACTIVE_COPIES',
        activeCopies: 1,
        lockMessage: expect.stringContaining('1 aparelho'),
      });
    });

    it('a lista diz quem (nome e usuário), em qual aparelho e desde quando', async () => {
      const { research } = setup('IN_FIELD');
      await research.downloadPackage(10, 'aparelho-A', ana);
      const list = await research.listCopies(10, admin);

      expect(list).toMatchObject({ activeCopies: 1, locked: true, lockReason: 'ACTIVE_COPIES' });
      expect(list.copies).toEqual([
        expect.objectContaining({
          status: 'ACTIVE',
          researcherName: 'Ana',
          researcherUsername: 'ana',
          deviceId: 'aparelho-A',
          downloadedAt: expect.any(String),
          returnedAt: null,
          revokedAt: null,
        }),
      ]);
    });

    it('pesquisador não vê a lista; administrador de outra empresa também não', async () => {
      const { research } = setup('IN_FIELD');
      await expect(research.listCopies(10, ana)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(research.listCopies(10, otherAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('4. a devolução é registrada com data e o contador cai', () => {
    it('registra a data, tira a cópia da contagem e mantém o histórico', async () => {
      const { research, db } = setup('IN_FIELD');
      await research.downloadPackage(10, 'aparelho-A', ana);
      await research.downloadPackage(10, 'aparelho-B', bruno);

      const result = await research.returnOwnCopy(10, 'aparelho-A', ana);
      expect(result).toMatchObject({ returned: true, activeCopies: 1, locked: true, returnedAt: expect.any(String) });

      const mine = db.ResearchDownload.find((d) => d.deviceId === 'aparelho-A');
      expect(mine).toMatchObject({ active: false, returnedAt: expect.any(String) });
      expect(db.ResearchDownload).toHaveLength(2); // nada é apagado

      const list = await research.listCopies(10, admin);
      expect(list.activeCopies).toBe(1);
      expect(list.copies.map((c: any) => [c.deviceId, c.status])).toEqual([
        ['aparelho-B', 'ACTIVE'],
        ['aparelho-A', 'RETURNED'],
      ]);
    });

    it('devolver duas vezes não falha nem mexe no contador dos outros', async () => {
      const { research } = setup('IN_FIELD');
      await research.downloadPackage(10, 'aparelho-A', ana);
      await research.downloadPackage(10, 'aparelho-B', bruno);
      await research.returnOwnCopy(10, 'aparelho-A', ana);

      expect(await research.returnOwnCopy(10, 'aparelho-A', ana)).toMatchObject({ returned: false, activeCopies: 1 });
    });

    it('um pesquisador só devolve a própria cópia', async () => {
      const { research } = setup('IN_FIELD');
      await research.downloadPackage(10, 'aparelho-A', ana);
      // Bruno devolvendo "o aparelho-A" não encontra cópia dele: a da Ana segue ativa.
      expect(await research.returnOwnCopy(10, 'aparelho-A', bruno)).toMatchObject({ returned: false, activeCopies: 1 });
      await expect(research.returnOwnCopy(10, 'aparelho-A', admin)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('5. contador em zero devolve a pesquisa ao estado editável, sozinho', () => {
    it('devolvida a última cópia, a API volta a aceitar edição — sem ninguém destravar', async () => {
      const { research, sections, questions, db } = setup('IN_FIELD');
      await research.downloadPackage(10, 'aparelho-A', ana);
      await research.downloadPackage(10, 'aparelho-B', bruno);

      await research.returnOwnCopy(10, 'aparelho-A', ana);
      await expect(questions.update(31, { statement: 'x' } as any, admin)).rejects.toEqual(LOCKED); // ainda trava (resta 1)

      await research.returnOwnCopy(10, 'aparelho-B', bruno);
      expect(await research.findOneWithLock(10, admin)).toMatchObject({ locked: false, activeCopies: 0, lockReason: null });

      await expect(questions.update(31, { statement: 'Editada' } as any, admin)).resolves.toBeDefined();
      await expect(sections.create({ researchId: 10, title: 'Novo', order: 2 } as any, admin)).resolves.toBeDefined();
      await expect(questions.createOption(30, 'Não', 2, admin)).resolves.toBeDefined();
      expect(db.Question.find((q) => q.id === 31)?.statement).toBe('Editada');
    });

    it('baixar de novo trava de novo', async () => {
      const { research, questions } = setup('IN_FIELD');
      await research.downloadPackage(10, 'aparelho-A', ana);
      await research.returnOwnCopy(10, 'aparelho-A', ana);
      await expect(questions.update(31, { statement: 'ok' } as any, admin)).resolves.toBeDefined();

      await research.downloadPackage(10, 'aparelho-A', ana);
      await expect(questions.update(31, { statement: 'não' } as any, admin)).rejects.toEqual(LOCKED);
    });

    it('pesquisa encerrada continua sem edição de estrutura, mesmo sem cópias', async () => {
      const { questions } = setup('CLOSED');
      await expect(questions.update(31, { statement: 'x' } as any, admin)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('6. o mesmo pesquisador em dois aparelhos conta como duas cópias', () => {
    it('dois aparelhos = duas cópias; o mesmo aparelho baixando de novo (atualizar) = continua uma', async () => {
      const { research, db } = setup('IN_FIELD');
      await research.downloadPackage(10, 'aparelho-A', ana);
      await research.downloadPackage(10, 'aparelho-B', ana);
      expect((await research.listCopies(10, admin)).activeCopies).toBe(2);

      await research.downloadPackage(10, 'aparelho-A', ana); // "atualizar a pesquisa" no mesmo celular
      expect((await research.listCopies(10, admin)).activeCopies).toBe(2);
      expect(db.ResearchDownload.filter((d) => d.active)).toHaveLength(2);
    });

    it('devolver um dos aparelhos mantém a trava pelo outro', async () => {
      const { research, questions } = setup('IN_FIELD');
      await research.downloadPackage(10, 'aparelho-A', ana);
      await research.downloadPackage(10, 'aparelho-B', ana);

      await research.returnOwnCopy(10, 'aparelho-A', ana);
      expect((await research.listCopies(10, admin)).activeCopies).toBe(1);
      await expect(questions.update(31, { statement: 'x' } as any, admin)).rejects.toEqual(LOCKED);
    });
  });

  describe('7. a revogação forçada libera o contador e invalida o acesso daquele aparelho', () => {
    async function twoCopies() {
      const env = setup('IN_FIELD');
      await env.research.downloadPackage(10, 'aparelho-perdido', ana);
      await env.research.downloadPackage(10, 'aparelho-B', bruno);
      const copyId = env.db.ResearchDownload.find((d) => d.deviceId === 'aparelho-perdido')!.id;
      return { ...env, copyId };
    }

    it('registra quem revogou, quando e por quê; o contador cai', async () => {
      const { research, db, copyId } = await twoCopies();
      const result = await research.revokeActiveCopy(10, copyId, 'Aparelho perdido em campo', admin);

      expect(result).toMatchObject({ activeCopies: 1, locked: true });
      expect(result.copy).toMatchObject({
        status: 'REVOKED',
        revokedByName: 'Adm',
        revokeReason: 'Aparelho perdido em campo',
        revokedAt: expect.any(String),
        researcherName: 'Ana',
      });
      expect(db.ResearchDownload.find((d) => d.id === copyId)).toMatchObject({
        active: false,
        revokedAt: expect.any(String),
        revokedById: 1,
        revokeReason: 'Aparelho perdido em campo',
      });
      expect(db.ResearchDownload).toHaveLength(2); // continua registrado
    });

    it('revogar a última cópia destrava a pesquisa', async () => {
      const { research, questions, copyId, db } = await twoCopies();
      const other = db.ResearchDownload.find((d) => d.deviceId === 'aparelho-B')!.id;

      await research.revokeActiveCopy(10, copyId, undefined, admin);
      await expect(questions.update(31, { statement: 'x' } as any, admin)).rejects.toEqual(LOCKED);

      await research.revokeActiveCopy(10, other, 'Pesquisador saiu', admin);
      await expect(questions.update(31, { statement: 'Liberada' } as any, admin)).resolves.toBeDefined();
    });

    it('o aparelho revogado não baixa de novo (e o código diz o porquê); outro aparelho do mesmo pesquisador baixa', async () => {
      const { research, copyId } = await twoCopies();
      await research.revokeActiveCopy(10, copyId, 'Perdido', admin);

      const error: any = await research.downloadPackage(10, 'aparelho-perdido', ana).catch((e) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toMatchObject({ code: 'COPY_REVOKED' });

      // mesmo aparelho, outro pesquisador logado nele: também barrado (é o aparelho que perde o acesso)
      await expect(research.downloadPackage(10, 'aparelho-perdido', bruno)).rejects.toBeInstanceOf(ForbiddenException);

      await expect(research.downloadPackage(10, 'aparelho-novo', ana)).resolves.toBeDefined();
    });

    it('o app descobre a revogação: a lista de pesquisas do aparelho traz copyStatus REVOKED', async () => {
      const { research, copyId } = await twoCopies();
      expect((await research.findAll(ana, 'aparelho-perdido') as any[])[0].copyStatus).toBe('ACTIVE');

      await research.revokeActiveCopy(10, copyId, 'Perdido', admin);
      expect((await research.findAll(ana, 'aparelho-perdido') as any[])[0].copyStatus).toBe('REVOKED');
      expect((await research.findAll(bruno, 'aparelho-B') as any[])[0].copyStatus).toBe('ACTIVE');

      // a tentativa de devolver depois da revogação avisa o app para apagar a cópia local
      expect(await research.returnOwnCopy(10, 'aparelho-perdido', ana)).toMatchObject({ returned: false, revoked: true });
    });

    it('revogar de novo não refaz nada; cópia já devolvida não se revoga; cópia de outra pesquisa não existe', async () => {
      const { research, db, copyId } = await twoCopies();
      await research.revokeActiveCopy(10, copyId, 'Perdido', admin);
      const revokedAt = db.ResearchDownload.find((d) => d.id === copyId)!.revokedAt;

      await research.revokeActiveCopy(10, copyId, 'Outro motivo', admin);
      expect(db.ResearchDownload.find((d) => d.id === copyId)).toMatchObject({ revokedAt, revokeReason: 'Perdido' });

      await research.returnOwnCopy(10, 'aparelho-B', bruno);
      const returnedId = db.ResearchDownload.find((d) => d.deviceId === 'aparelho-B')!.id;
      await expect(research.revokeActiveCopy(10, returnedId, 'x', admin)).rejects.toBeInstanceOf(BadRequestException);
      await expect(research.revokeActiveCopy(10, 9999, 'x', admin)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('desbloquear aparelho: o histórico da revogação fica, o aparelho volta a baixar e a pesquisa trava de novo', async () => {
      const { research, questions, db, copyId } = await twoCopies();
      await research.revokeActiveCopy(10, copyId, 'Perdido', admin);
      await expect(research.downloadPackage(10, 'aparelho-perdido', ana)).rejects.toBeInstanceOf(ForbiddenException);

      const result = await research.unblockCopyDevice(10, copyId, admin);
      expect(result.copy).toMatchObject({
        status: 'REVOKED', // a revogação continua registrada
        revokeReason: 'Perdido',
        unblockedByName: 'Adm',
        unblockedAt: expect.any(String),
        deviceBlocked: false,
      });
      expect(db.ResearchDownload.find((d) => d.id === copyId)).toMatchObject({ unblockedById: 1, revokedAt: expect.any(String) });

      // o contador não mudou só por desbloquear (a cópia revogada já não contava)
      expect(result.activeCopies).toBe(1);

      // volta a baixar: nova cópia ativa, sem apagar a revogada
      await expect(research.downloadPackage(10, 'aparelho-perdido', ana)).resolves.toBeDefined();
      expect((await research.listCopies(10, admin)).activeCopies).toBe(2);
      expect(db.ResearchDownload).toHaveLength(3);
      expect((await research.findAll(ana, 'aparelho-perdido') as any[])[0].copyStatus).toBe('ACTIVE');
      await expect(questions.update(31, { statement: 'x' } as any, admin)).rejects.toEqual(LOCKED);
    });

    it('a lista marca quais aparelhos estão bloqueados agora (só eles podem ser desbloqueados)', async () => {
      const { research, copyId } = await twoCopies();
      await research.revokeActiveCopy(10, copyId, 'Perdido', admin);

      let list = await research.listCopies(10, admin);
      expect(list.copies.find((c: any) => c.id === copyId)).toMatchObject({ status: 'REVOKED', deviceBlocked: true });
      expect(list.copies.find((c: any) => c.status === 'ACTIVE')).toMatchObject({ deviceBlocked: false });

      await research.unblockCopyDevice(10, copyId, admin);
      list = await research.listCopies(10, admin);
      expect(list.copies.find((c: any) => c.id === copyId)).toMatchObject({ deviceBlocked: false, unblockedByName: 'Adm' });
    });

    it('desbloquear é idempotente e só vale para cópia revogada', async () => {
      const { research, db, copyId } = await twoCopies();
      const activeId = db.ResearchDownload.find((d) => d.deviceId === 'aparelho-B')!.id;
      await expect(research.unblockCopyDevice(10, activeId, admin)).rejects.toBeInstanceOf(BadRequestException);
      await expect(research.unblockCopyDevice(10, 9999, admin)).rejects.toBeInstanceOf(NotFoundException);

      await research.revokeActiveCopy(10, copyId, 'Perdido', admin);
      await research.unblockCopyDevice(10, copyId, admin);
      const unblockedAt = db.ResearchDownload.find((d) => d.id === copyId)!.unblockedAt;
      await research.unblockCopyDevice(10, copyId, admin);
      expect(db.ResearchDownload.find((d) => d.id === copyId)!.unblockedAt).toBe(unblockedAt);
    });

    it('revogar de novo depois de desbloquear bloqueia o aparelho outra vez', async () => {
      const { research, db, copyId } = await twoCopies();
      await research.revokeActiveCopy(10, copyId, 'Perdido', admin);
      await research.unblockCopyDevice(10, copyId, admin);
      await research.downloadPackage(10, 'aparelho-perdido', ana);
      const newCopy = db.ResearchDownload.find((d) => d.deviceId === 'aparelho-perdido' && d.active)!;

      await research.revokeActiveCopy(10, newCopy.id, 'Perdido de novo', admin);
      await expect(research.downloadPackage(10, 'aparelho-perdido', ana)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('só administrador da empresa da pesquisa desbloqueia', async () => {
      const { research, copyId } = await twoCopies();
      await research.revokeActiveCopy(10, copyId, 'Perdido', admin);
      await expect(research.unblockCopyDevice(10, copyId, ana)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(research.unblockCopyDevice(10, copyId, otherAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('só administrador da empresa da pesquisa revoga', async () => {
      const { research, copyId } = await twoCopies();
      await expect(research.revokeActiveCopy(10, copyId, 'x', ana)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(research.revokeActiveCopy(10, copyId, 'x', otherAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('8. vincular pesquisador, mudar meta, prorrogar prazo, acompanhar e emitir relatório seguem liberados', () => {
    it('com a trava ligada: vincular, mudar meta, desvincular, prorrogar prazo e avançar o status funcionam', async () => {
      const { research, db } = setup('IN_FIELD');
      db.User.push({ id: 5, name: 'Carla', username: 'carla', profile: 'RESEARCHER', companyId: 1, situation: 'ACTIVE' });
      await research.downloadPackage(10, 'aparelho-A', ana);
      expect((await research.findOneWithLock(10, admin)).locked).toBe(true);

      await research.addResearcher(10, 5, admin, 30); // vincular
      expect(db.ResearchResearcher.find((l) => l.userId === 5)?.targetCount).toBe(30);

      await research.updateResearcherTarget(10, 2, 200, admin); // meta
      expect(db.ResearchResearcher.find((l) => l.userId === 2)?.targetCount).toBe(200);

      await research.update(10, { endDate: '3000-06-30', title: 'Satisfação 2026', description: 'ajuste' }, admin); // prorrogar prazo e dados
      expect(db.Research[0]).toMatchObject({ endDate: '3000-06-30', title: 'Satisfação 2026' });

      await research.update(10, { status: 'CLOSED' as any }, admin); // ciclo de vida
      expect(db.Research[0].status).toBe('CLOSED');

      await research.removeResearcher(10, 5, admin); // desvincular
      expect(db.ResearchResearcher.some((l) => l.userId === 5)).toBe(false);
    });

    it('acompanhar: lista de vinculados com progresso e detalhe da pesquisa seguem abertos', async () => {
      const { research, db } = setup('IN_FIELD');
      db.Collection.push({ id: 1, researchId: 10, researcherId: 2 });
      await research.downloadPackage(10, 'aparelho-A', ana);

      const rows = await research.listResearchers(10, admin);
      expect(rows.find((r: any) => r.userId === 2)).toMatchObject({ collected: 1, targetCount: 50 });
      await expect(research.findOne(10, admin)).resolves.toMatchObject({ id: 10 });
    });

    it('a trava não depende de edição de dados: o pesquisador baixa e devolve normalmente', async () => {
      const { research } = setup('IN_FIELD');
      await expect(research.downloadPackage(10, 'aparelho-A', ana)).resolves.toBeDefined();
      await expect(research.returnOwnCopy(10, 'aparelho-A', ana)).resolves.toMatchObject({ returned: true });
    });
  });
});

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ResearchService } from './research.service.js';

// Evita carregar o cliente do banco (ESM) e o armazenamento de mídia: aqui o banco é simulado em memória.
jest.mock('../prisma.service.js', () => ({ PrismaService: class { } }));
jest.mock('../collection/audio-storage.js', () => ({ AudioStorage: class { } }));

/**
 * Tabelas em memória no lugar do banco: o suficiente para o ORM encadeado
 * `where(...).first()/all()/update()/delete()`.
 */
function fakePrisma(db: Record<string, any[]>) {
  const table = (name: string) => ({
    where: (filter: Record<string, unknown>) => {
      const match = () => db[name].filter((row) => Object.entries(filter).every(([k, v]) => row[k] === v));
      return {
        first: async () => match()[0] ?? null,
        all: async () => match(),
        update: async (data: object) => { const [row] = match(); Object.assign(row, data); return row; },
        delete: async () => { const rows = match(); db[name] = db[name].filter((r) => !rows.includes(r)); return rows[0] ?? null; },
      };
    },
    create: async (data: object) => { const row = { id: db[name].length + 1, ...data }; db[name].push(row); return row; },
    all: async () => db[name],
  });
  const orm = { public: Object.fromEntries(Object.keys(db).map((n) => [n, table(n)])) };
  return { client: { orm } } as any;
}

const admin = { sub: 'adm', profile: 'ADMINISTRATOR', companyId: 1 } as any;
const ana = { sub: 'ana', profile: 'RESEARCHER', companyId: 1 } as any;
const bruno = { sub: 'bruno', profile: 'RESEARCHER', companyId: 1 } as any;

function setup() {
  const db: Record<string, any[]> = {
    User: [
      { id: 1, name: 'Adm', username: 'adm', profile: 'ADMINISTRATOR', companyId: 1 },
      { id: 2, name: 'Ana', username: 'ana', profile: 'RESEARCHER', companyId: 1, situation: 'ACTIVE' },
      { id: 3, name: 'Bruno', username: 'bruno', profile: 'RESEARCHER', companyId: 1, situation: 'ACTIVE' },
    ],
    Research: [
      { id: 10, status: 'IN_FIELD', companyId: 1 },
      { id: 11, status: 'DRAFT', companyId: 1 },
    ],
    ResearchResearcher: [
      { id: 1, researchId: 10, userId: 2, targetCount: 50 },
      { id: 2, researchId: 11, userId: 2, targetCount: 5 },
    ],
    Collection: [
      { id: 1, researchId: 10, researcherId: 2 },
      { id: 2, researchId: 10, researcherId: 2 },
    ],
    ResearchDownload: [],
  };
  return { db, service: new ResearchService(fakePrisma(db), {} as any) };
}

describe('Meta de coletas por pesquisador (W10)', () => {
  it('pesquisador só vê pesquisa publicada à qual está vinculado', async () => {
    const { service } = setup();
    expect((await service.findAll(ana)).map((r: any) => r.id)).toEqual([10]); // a 11 é rascunho
    expect(await service.findAll(bruno)).toEqual([]);
    await expect(service.findOne(10, bruno)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findOne(10, ana)).resolves.toMatchObject({ id: 10 });
  });

  it('lista vinculados com meta e quanto cada um já entregou', async () => {
    const { service } = setup();
    const rows = await service.listResearchers(10, admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 2, name: 'Ana', targetCount: 50, collected: 2, remaining: 48, progress: 4 });
    await expect(service.listResearchers(10, ana)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('vincula com meta e altera a meta com a pesquisa em campo', async () => {
    const { service, db } = setup();
    await service.addResearcher(10, 3, admin, 30);
    expect(db.ResearchResearcher.find((l) => l.userId === 3)?.targetCount).toBe(30);

    await service.updateResearcherTarget(10, 3, 120, admin); // pesquisa 10 está IN_FIELD
    expect(db.ResearchResearcher.find((l) => l.userId === 3)?.targetCount).toBe(120);

    await expect(service.updateResearcherTarget(10, 3, 5, ana)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('não altera meta de quem não está vinculado', async () => {
    const { service } = setup();
    await expect(service.updateResearcherTarget(10, 3, 10, admin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('desvincular não apaga as coletas já recebidas', async () => {
    const { service, db } = setup();
    await service.removeResearcher(10, 2, admin);
    expect(db.ResearchResearcher.some((l) => l.researchId === 10 && l.userId === 2)).toBe(false);
    expect(db.Collection).toHaveLength(2);
    await expect(service.findOne(10, ana)).rejects.toBeInstanceOf(NotFoundException);
  });
});

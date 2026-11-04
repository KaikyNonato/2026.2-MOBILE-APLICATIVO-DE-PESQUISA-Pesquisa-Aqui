import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AudioStorage } from './audio-storage';
import { CollectionService } from './collection.service';

type Row = Record<string, any>;

/** Banco em memória, só o suficiente para o fluxo de coleta. */
function makeDb(seed: { research: Row; links?: Row[]; questions?: Row[]; options?: Row[] }) {
  const tables: Record<string, Row[]> = {
    User: [
      { id: 1, name: 'Paula', username: 'paula', profile: 'RESEARCHER', companyId: 10 },
      { id: 2, name: 'Admin', username: 'admin', profile: 'ADMINISTRATOR', companyId: 10 },
    ],
    Research: [seed.research],
    ResearchResearcher: seed.links ?? [{ id: 1, researchId: 5, userId: 1 }],
    Section: [{ id: 50, researchId: 5, title: 'Perfil', order: 1 }],
    Question: seed.questions ?? [{ id: 100, sectionId: 50, statement: 'Pergunta', type: 'FREE_TEXT', order: 1, isRequired: false }],
    QuestionOption: seed.options ?? [],
    Collection: [],
    Answer: [],
  };
  let nextId = 1;
  const model = (name: string) => ({
    where: (filter: Row) => {
      const match = () => tables[name].filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v));
      return {
        first: async () => match()[0] ?? null,
        all: async () => match(),
        delete: async () => {
          tables[name] = tables[name].filter((r) => !match().includes(r));
        },
      };
    },
    create: async (data: Row) => {
      const row = { id: nextId++, receivedAt: '2026-10-10T15:00:00.000Z', ...data };
      tables[name].push(row);
      return row;
    },
  });
  const orm = { public: new Proxy({}, { get: (_t, name: string) => model(name) }) };
  return { tables, prisma: { client: { orm } } as any };
}

const baseResearch = { id: 5, companyId: 10, status: 'IN_FIELD', recordInterview: true };
const researcher = { sub: 'paula', username: 'paula', profile: 'RESEARCHER', companyId: 10 } as any;
const admin = { sub: 'admin', username: 'admin', profile: 'ADMINISTRATOR', companyId: 10 } as any;

const consent = { accepted: true, acceptedAt: '2026-10-10T13:59:00.000Z' };
const payload = (extra: Row = {}) => ({
  researchId: 5,
  startedAt: '2026-10-10T14:00:00.000Z',
  finishedAt: '2026-10-10T14:10:00.000Z',
  answers: [{ questionId: 100, value: 'sim' }],
  audioDurationSeconds: 600,
  consent,
  ...extra,
});
const audio = { originalname: 'a.m4a', mimetype: 'audio/mp4', size: 4, buffer: Buffer.from([1, 2, 3, 4]) };

function setup(research: Row = baseResearch) {
  const db = makeDb({ research });
  const storage = {
    save: jest.fn(async () => '5/abc.m4a'),
    open: jest.fn(async () => ({ stream: {} as any, size: 4 })),
    remove: jest.fn(async () => undefined),
    saveAt: jest.fn(async () => undefined),
    list: jest.fn(async () => []),
    removeDir: jest.fn(async () => undefined),
  };
  const service = new CollectionService(db.prisma, storage as unknown as AudioStorage);
  return { db, storage, service };
}

describe('CollectionService.create', () => {
  it('pesquisa encerrada não recebe coleta nova (resultado congelado)', async () => {
    const { db, storage, service } = setup({ ...baseResearch, status: 'CLOSED', title: 'Encerrada' });
    await expect(service.create(payload({ clientId: '11111111-1111-4111-8111-111111111111' }) as any, audio, researcher)).rejects.toMatchObject({
      response: { code: 'RESEARCH_CLOSED' },
    });
    expect(db.tables.Collection).toHaveLength(0);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('grava a coleta com o consentimento (data, hora e quem confirmou) e o áudio', async () => {
    const { db, storage, service } = setup();
    const result = await service.create(payload() as any, audio, researcher);

    expect(storage.save).toHaveBeenCalledTimes(1);
    const saved = db.tables.Collection[0];
    expect(saved.consentGiven).toBe(true);
    expect(saved.consentAt).toBe('2026-10-10T13:59:00.000Z');
    expect(saved.consentConfirmedById).toBe(1);
    expect(saved.audioPath).toBe('5/abc.m4a');
    expect(db.tables.Answer).toHaveLength(1);
    expect(result.hasAudio).toBe(true);
    expect(result.audioDurationSeconds).toBe(600);
    expect(result.consent.confirmedByName).toBe('Paula');
  });

  it('recusa coleta de pesquisa com gravação sem consentimento — e não grava nada', async () => {
    const { db, storage, service } = setup();
    await expect(service.create(payload({ consent: undefined }) as any, audio, researcher)).rejects.toMatchObject({
      response: { code: 'CONSENT_REQUIRED' },
    });
    await expect(
      service.create(payload({ consent: { accepted: false, acceptedAt: consent.acceptedAt } }) as any, audio, researcher),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.tables.Collection).toHaveLength(0);
    expect(db.tables.Answer).toHaveLength(0);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('recusa sem consentimento mesmo que a coleta venha sem áudio', async () => {
    const { db, service } = setup();
    await expect(service.create(payload({ consent: undefined }) as any, undefined, researcher)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.tables.Collection).toHaveLength(0);
  });

  it('em pesquisa sem gravação, aceita a coleta sem consentimento e não registra aceite', async () => {
    const { db, service } = setup({ ...baseResearch, recordInterview: false });
    await service.create(payload({ consent: undefined }) as any, undefined, researcher);
    expect(db.tables.Collection[0].consentGiven).toBe(false);
    expect(db.tables.Collection[0].consentConfirmedById).toBeNull();
  });

  it('em pesquisa sem gravação, recusa áudio', async () => {
    const { db, storage, service } = setup({ ...baseResearch, recordInterview: false });
    await expect(service.create(payload() as any, audio, researcher)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.save).not.toHaveBeenCalled();
    expect(db.tables.Collection).toHaveLength(0);
  });

  it('recusa formato que não é áudio', async () => {
    const { service } = setup();
    await expect(service.create(payload() as any, { ...audio, mimetype: 'text/html' }, researcher)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa resposta de questão que não é da pesquisa, sem deixar áudio no disco', async () => {
    const { db, storage, service } = setup();
    await expect(
      service.create(payload({ answers: [{ questionId: 999, value: 'x' }] }) as any, audio, researcher),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.save).not.toHaveBeenCalled();
    expect(db.tables.Collection).toHaveLength(0);
  });

  it('reenvio com o mesmo clientId não duplica a coleta', async () => {
    const { db, storage, service } = setup();
    const first = await service.create(payload({ clientId: 'c-1' }) as any, audio, researcher);
    const second = await service.create(payload({ clientId: 'c-1' }) as any, audio, researcher);
    expect(second.id).toBe(first.id);
    expect(db.tables.Collection).toHaveLength(1);
    expect(storage.save).toHaveBeenCalledTimes(1);
  });

  it('só pesquisador vinculado envia coleta', async () => {
    const { service } = setup();
    await expect(service.create(payload() as any, audio, admin)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa pesquisa em rascunho', async () => {
    const { service } = setup({ ...baseResearch, status: 'DRAFT' });
    await expect(service.create(payload() as any, audio, researcher)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CollectionService — acesso ao áudio e à lista', () => {
  async function withCollection() {
    const ctx = setup();
    await ctx.service.create(payload() as any, audio, researcher);
    return ctx;
  }

  it('administrador da empresa da pesquisa ouve o áudio', async () => {
    const { service } = await withCollection();
    const file = await service.getAudio(1, admin);
    expect(file.mimeType).toBe('audio/mp4');
    expect(file.size).toBe(4);
  });

  it('quem é de outra empresa não ouve, nem lista', async () => {
    const { service } = await withCollection();
    const outsider = { ...admin, companyId: 99 };
    await expect(service.getAudio(1, outsider)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.findAll(5, outsider)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('pesquisador e superadministrador não ouvem o áudio', async () => {
    const { service } = await withCollection();
    await expect(service.getAudio(1, researcher)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getAudio(1, { ...admin, profile: 'SUPERADMINISTRATOR', companyId: null })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('coleta sem gravação responde 404 no áudio', async () => {
    const ctx = setup({ ...baseResearch, recordInterview: false });
    await ctx.service.create(payload({ consent: undefined }) as any, undefined, researcher);
    await expect(ctx.service.getAudio(1, admin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a lista indica quais coletas têm gravação e a duração de cada uma', async () => {
    const { service } = await withCollection();
    await service.create(payload({ clientId: 'sem-audio', audioDurationSeconds: undefined }) as any, undefined, researcher);

    const list = await service.findAll(5, admin);
    expect(list).toHaveLength(2);
    const withAudio = list.find((c) => c.hasAudio)!;
    const without = list.find((c) => !c.hasAudio)!;
    expect(withAudio.audioDurationSeconds).toBe(600);
    expect(without.audioDurationSeconds).toBeNull();
  });
});

describe('CollectionService.findOne — respostas da coleta', () => {
  function setupWithQuestions() {
    const db = makeDb({
      research: baseResearch,
      questions: [
        { id: 101, sectionId: 50, statement: 'Segunda', type: 'SINGLE_CHOICE', order: 2, isRequired: true },
        { id: 100, sectionId: 50, statement: 'Primeira', type: 'FREE_TEXT', order: 1, isRequired: false },
        { id: 102, sectionId: 50, statement: 'Sem resposta', type: 'NUMERIC', order: 3, isRequired: false },
      ],
      options: [
        { id: 2, questionId: 101, text: 'Não', order: 2 },
        { id: 1, questionId: 101, text: 'Sim', order: 1 },
      ],
    });
    const storage = { save: jest.fn(async () => '5/abc.m4a'), open: jest.fn(), remove: jest.fn(), list: jest.fn(async () => []) };
    const service = new CollectionService(db.prisma, storage as unknown as AudioStorage);
    return { db, service };
  }

  const answersPayload = () =>
    payload({
      answers: [
        { questionId: 101, value: '1' },
        { questionId: 100, value: 'texto livre' },
      ],
    }) as any;

  it('devolve as perguntas na ordem do questionário, com as opções e a resposta de cada uma', async () => {
    const { service } = setupWithQuestions();
    await service.create(answersPayload(), audio, researcher);

    const detail = await service.findOne(1, admin);
    expect(detail.researcherName).toBe('Paula');
    expect(detail.hasAudio).toBe(true);
    expect(detail.sections).toHaveLength(1);

    const questions = detail.sections[0].questions;
    expect(questions.map((q) => q.statement)).toEqual(['Primeira', 'Segunda', 'Sem resposta']);
    expect(questions[0].answer).toBe('texto livre');
    expect(questions[1].answer).toBe('1');
    expect(questions[1].options.map((o) => o.text)).toEqual(['Sim', 'Não']);
    expect(questions[2].answer).toBeNull();
  });

  it('coleta inexistente responde 404', async () => {
    const { service } = setupWithQuestions();
    await expect(service.findOne(999, admin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('quem é de outra empresa, pesquisador e superadministrador não abrem as respostas', async () => {
    const { service } = setupWithQuestions();
    await service.create(answersPayload(), audio, researcher);

    await expect(service.findOne(1, { ...admin, companyId: 99 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.findOne(1, researcher)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.findOne(1, { ...admin, profile: 'SUPERADMINISTRATOR', companyId: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

/** Armazenamento em memória: guarda os arquivos por caminho relativo, como o disco faria. */
class FakeStorage {
  files = new Map<string, Buffer>();
  failOnSaveAt = false;
  save = jest.fn(async () => '5/abc.m4a');
  remove = jest.fn(async () => undefined);
  saveAt = jest.fn(async (path: string, buffer: Buffer) => {
    if (this.failOnSaveAt) throw new Error('disco cheio');
    this.files.set(path, buffer);
  });
  list = jest.fn(async (dir: string) =>
    [...this.files.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1)),
  );
  removeDir = jest.fn(async (dir: string) => {
    for (const key of [...this.files.keys()]) if (key.startsWith(`${dir}/`)) this.files.delete(key);
  });
  open = jest.fn(async (path: string) => {
    const file = this.files.get(path);
    return file ? { stream: {} as any, size: file.length } : null;
  });
}

describe('CollectionService — fotos e áudios das respostas', () => {
  const jpeg = (bytes: number[]) => ({ originalname: 'f.jpg', mimetype: 'image/jpeg', size: bytes.length, buffer: Buffer.from(bytes) });
  const voice = (bytes: number[]) => ({ originalname: 'v.m4a', mimetype: 'audio/mp4', size: bytes.length, buffer: Buffer.from(bytes) });

  function setupMedia() {
    const db = makeDb({
      research: { ...baseResearch, recordInterview: false },
      questions: [
        { id: 201, sectionId: 50, statement: 'Foto', type: 'PHOTO', order: 1, isRequired: false },
        { id: 202, sectionId: 50, statement: 'Fotos', type: 'MULTIPLE_PHOTOS', order: 2, isRequired: false },
        { id: 203, sectionId: 50, statement: 'Fale', type: 'AUDIO', order: 3, isRequired: false },
        { id: 204, sectionId: 50, statement: 'Texto', type: 'FREE_TEXT', order: 4, isRequired: false },
      ],
    });
    const storage = new FakeStorage();
    const service = new CollectionService(db.prisma, storage as unknown as AudioStorage);
    const body = (extra: Row = {}) =>
      ({
        ...payload({ consent: undefined, answers: [], audioDurationSeconds: undefined }),
        photos: [{ questionId: 201 }, { questionId: 202 }, { questionId: 202 }],
        questionAudios: [{ questionId: 203, durationSeconds: 5 }],
        ...extra,
      }) as any;
    const media = () => ({
      photos: [jpeg([1]), jpeg([2, 2]), jpeg([3, 3, 3])],
      questionAudios: [voice([9, 9])],
    });
    return { db, storage, service, body, media };
  }

  it('guarda cada arquivo na pasta da coleta, com nome montado pelo servidor', async () => {
    const { storage, service, body, media } = setupMedia();
    await service.create(body(), undefined, researcher, media());

    expect([...storage.files.keys()].sort()).toEqual([
      '5/answers/1/q201-0.jpg',
      '5/answers/1/q202-0.jpg',
      '5/answers/1/q202-1.jpg',
      '5/answers/1/q203-0.m4a',
    ]);
    expect(storage.files.get('5/answers/1/q202-1.jpg')).toEqual(Buffer.from([3, 3, 3]));
  });

  it('a coleta aberta lista os arquivos de cada questão, na ordem do envio', async () => {
    const { service, body, media } = setupMedia();
    await service.create(body(), undefined, researcher, media());

    const questions = (await service.findOne(1, admin)).sections[0].questions;
    const byId = (id: number) => questions.find((q) => q.id === id)!;
    expect(byId(201).files).toEqual([{ name: 'q201-0.jpg', mimeType: 'image/jpeg' }]);
    expect(byId(202).files.map((f) => f.name)).toEqual(['q202-0.jpg', 'q202-1.jpg']);
    expect(byId(203).files).toEqual([{ name: 'q203-0.m4a', mimeType: 'audio/mp4' }]);
    expect(byId(204).files).toEqual([]);
  });

  it('recusa quando a quantidade de arquivos não confere com a lista do payload', async () => {
    const { storage, service, body } = setupMedia();
    await expect(
      service.create(body(), undefined, researcher, { photos: [jpeg([1])], questionAudios: [voice([9])] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.files.size).toBe(0);
  });

  it('recusa arquivo ligado a questão de outro tipo ou de outra pesquisa', async () => {
    const { service, body, media } = setupMedia();
    await expect(
      service.create(body({ photos: [{ questionId: 204 }, { questionId: 202 }, { questionId: 202 }] }), undefined, researcher, media()),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(body({ photos: [{ questionId: 999 }, { questionId: 202 }, { questionId: 202 }] }), undefined, researcher, media()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa formato não suportado e arquivo vazio', async () => {
    const { service, body } = setupMedia();
    const pdf = { originalname: 'x.pdf', mimetype: 'application/pdf', size: 3, buffer: Buffer.from([1, 2, 3]) };
    await expect(
      service.create(body(), undefined, researcher, { photos: [pdf, jpeg([2]), jpeg([3])], questionAudios: [voice([9])] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(body(), undefined, researcher, { photos: [jpeg([]), jpeg([2]), jpeg([3])], questionAudios: [voice([9])] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('se gravar um arquivo falhar, não deixa coleta pela metade nem arquivo órfão', async () => {
    const { db, storage, service, body, media } = setupMedia();
    storage.failOnSaveAt = true;

    await expect(service.create(body(), undefined, researcher, media())).rejects.toThrow('disco cheio');
    expect(db.tables.Collection).toHaveLength(0);
    expect(storage.removeDir).toHaveBeenCalledWith('5/answers/1');
    expect(storage.files.size).toBe(0);
  });

  it('administrador da empresa abre o arquivo; os demais não', async () => {
    const { service, body, media } = setupMedia();
    await service.create(body(), undefined, researcher, media());

    const file = await service.getMedia(1, 'q201-0.jpg', admin);
    expect(file.mimeType).toBe('image/jpeg');
    expect(file.size).toBe(1);

    await expect(service.getMedia(1, 'q201-0.jpg', { ...admin, companyId: 99 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getMedia(1, 'q201-0.jpg', researcher)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('nome fora do padrão, caminho com ../ e arquivo inexistente respondem 404', async () => {
    const { service, body, media } = setupMedia();
    await service.create(body(), undefined, researcher, media());

    for (const name of ['../x.jpg', '..%2Fx.jpg', 'q201-0.php', 'qualquer.jpg', 'q201-9.jpg']) {
      await expect(service.getMedia(1, name, admin)).rejects.toBeInstanceOf(NotFoundException);
    }
  });
});

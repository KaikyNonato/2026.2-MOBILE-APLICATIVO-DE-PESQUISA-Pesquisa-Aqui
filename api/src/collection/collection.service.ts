import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { AudioStorage, audioExtensionFor, imageExtensionFor, mediaTypeFor } from './audio-storage.js';
import { assertValidConsent } from './consent.js';
import { normalizeText, pageParams, runPaged, toPage, type CollectionPageQueryDto } from '../common/pagination.js';
import { copyRevokedException, isDeviceRevoked } from '../research/research-copies.js';
import type { CollectionPayloadDto } from './dto/create-collection.dto.js';
import type { UploadCollectionFileDto } from './dto/upload-collection-file.dto.js';
import {
  audioMaxBytes,
  fileStem,
  formatLimit,
  looksLikeAudio,
  looksLikeImage,
  photoMaxBytes,
  storedFileName,
} from './media-validation.js';

export interface UploadedAudio {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

// Arquivos das respostas que chegam junto da coleta (cada lista segue a ordem de `payload.photos` / `payload.questionAudios`).
export interface UploadedMedia {
  photos?: UploadedAudio[];
  questionAudios?: UploadedAudio[];
}

// Foto reduzida pelo app costuma ter poucos MB; acima disso é arquivo errado ou abuso.
const MAX_PHOTO_BYTES = 30 * 1024 * 1024;

// Nome dos arquivos de resposta guardados: montado pelo servidor.
//  - `q<questão>-<posição>.<extensão>`: envio antigo (arquivos junto da coleta)
//  - `q<questão>-f<identificador>.<extensão>`: envio de arquivo separado (o identificador vem do nome no aparelho)
const MEDIA_NAME = /^q(\d{1,10})-(\d{1,4}|f[0-9a-f-]{8,41})\.([a-z0-9]{2,5})$/;

const FILE_QUESTION_TYPES = ['PHOTO', 'MULTIPLE_PHOTOS', 'AUDIO'];

/** Nomes de arquivo que a resposta de uma questão de foto/áudio guarda. */
function answerFileNames(type: string, answer: string | null): string[] {
  if (answer === null || answer.trim() === '') return [];
  if (type === 'MULTIPLE_PHOTOS') {
    try {
      const parsed: unknown = JSON.parse(answer);
      return Array.isArray(parsed) ? parsed.map(String) : [answer];
    } catch {
      return [answer];
    }
  }
  return [answer];
}

/** Recusa de arquivo com código legível pela máquina (o aplicativo decide se tenta de novo). */
export function fileRejection(Exception: typeof BadRequestException | typeof NotFoundException, code: string, message: string, retryable: boolean) {
  return new Exception({ statusCode: Exception === NotFoundException ? 404 : 400, code, message, retryable });
}

/**
 * Regras de coletas: recebimento (com consentimento e áudio), listagens, abertura das respostas e
 * envio de arquivos.
 */
@Injectable()
export class CollectionService {
  constructor(
    private prisma: PrismaService,
    private audioStorage: AudioStorage,
  ) { }

  /**
   * Recebe uma coleta feita no aplicativo: respostas, consentimento e (se a pesquisa grava) o
   * áudio.
   */
  async create(
    payload: CollectionPayloadDto,
    audio: UploadedAudio | undefined,
    currentUser: UserPayLoad,
    media: UploadedMedia = {},
  ) {
    if (currentUser.profile !== 'RESEARCHER') {
      throw new ForbiddenException('Somente pesquisadores enviam coletas.');
    }

    const orm = this.prisma.client.orm.public;

    // No token, `sub` é o username (não o id numérico)
    const user = await orm.User.where({ username: String(currentUser.sub) }).first();
    if (!user) throw new ForbiddenException('Usuário não encontrado.');

    const research = await orm.Research.where({ id: payload.researchId }).first();
    if (!research || research.status === 'DRAFT' || research.companyId !== currentUser.companyId) {
      throw new NotFoundException('Pesquisa não encontrada.');
    }

    const link = await orm.ResearchResearcher.where({ researchId: research.id, userId: user.id }).first();
    if (!link) throw new ForbiddenException('Você não está vinculado a esta pesquisa.');

    // Reenvio de coleta que já chegou continua reconhecido; coleta nova de pesquisa encerrada não entra (resultado congelado).
    const alreadyReceived = payload.clientId
      ? await orm.Collection.where({ researchId: research.id, researcherId: user.id, clientId: payload.clientId }).first()
      : null;
    if (research.status === 'CLOSED' && !alreadyReceived) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'RESEARCH_CLOSED',
        message: `A pesquisa "${research.title}" está encerrada e não recebe mais coletas.`,
      });
    }

    // Aparelho com a cópia revogada pelo administrador não envia coleta nova.
    if (await isDeviceRevoked(orm, research.id, payload.deviceId)) {
      throw copyRevokedException('O administrador revogou o acesso deste aparelho a esta pesquisa. A coleta não foi aceita.');
    }

    // Reenvio da mesma coleta (conexão caiu depois de o servidor receber): devolve a já gravada.
    if (payload.clientId) {
      const existing = await orm.Collection.where({
        researchId: research.id,
        researcherId: user.id,
        clientId: payload.clientId,
      }).first();
      if (existing) return this.toSummary(existing, user.name, user.name);
    }

    if (new Date(payload.finishedAt) < new Date(payload.startedAt)) {
      throw new BadRequestException('O fim da coleta não pode ser anterior ao início.');
    }

    // Consentimento: sem ele, o servidor recusa a coleta de pesquisa que grava — mesmo com o app liberando.
    let consentAt: Date | null = null;
    if (research.recordInterview) {
      consentAt = assertValidConsent(payload.consent, payload.startedAt);
    } else if (audio) {
      throw new BadRequestException('Esta pesquisa não grava a entrevista: o áudio foi recusado.');
    }

    let audioExtension: string | null = null;
    if (audio) {
      audioExtension = audioExtensionFor(audio.mimetype);
      if (!audioExtension) throw new BadRequestException('Formato de áudio não suportado.');
      if (!audio.size || audio.buffer.length === 0) throw new BadRequestException('O arquivo de áudio está vazio.');
    }

    const questionTypes = await this.loadQuestionTypes(research.id);
    this.assertAnswersBelongToResearch(questionTypes, payload.answers);
    const mediaFiles = this.planMedia(questionTypes, payload, media);

    // Tudo validado: só agora o áudio vai para o disco.
    const audioPath = audio && audioExtension
      ? await this.audioStorage.save(research.id, audio.buffer, audioExtension)
      : null;

    let collection;
    let mediaDir: string | null = null;
    try {
      collection = await orm.Collection.create({
        researchId: research.id,
        researcherId: user.id,
        deviceId: payload.deviceId ?? null,
        clientId: payload.clientId ?? null,
        startedAt: new Date(payload.startedAt).toISOString(),
        finishedAt: new Date(payload.finishedAt).toISOString(),
        startLatitude: payload.startLocation?.latitude ?? null,
        startLongitude: payload.startLocation?.longitude ?? null,
        locationAccuracy: payload.startLocation?.accuracy ?? null,
        consentGiven: consentAt !== null,
        consentAt: consentAt ? consentAt.toISOString() : null,
        // quem confirmou o aceite: o pesquisador autenticado, nunca um valor enviado pelo aparelho
        consentConfirmedById: consentAt ? user.id : null,
        audioPath,
        audioMimeType: audio ? audio.mimetype : null,
        audioSizeBytes: audio ? audio.buffer.length : null,
        audioDurationSeconds: audio ? (payload.audioDurationSeconds ?? null) : null,
      });

      for (const answer of payload.answers) {
        await orm.Answer.create({
          questionId: answer.questionId,
          value: answer.value,
          collectionId: collection.id,
        });
      }

      if (mediaFiles.length > 0) {
        mediaDir = this.mediaDir(research.id, collection.id);
        for (const file of mediaFiles) await this.audioStorage.saveAt(`${mediaDir}/${file.fileName}`, file.buffer);
      }
    } catch (error) {
      // Não deixa coleta pela metade nem áudio órfão.
      if (collection) await orm.Collection.where({ id: collection.id }).delete().catch(() => undefined);
      if (audioPath) await this.audioStorage.remove(audioPath).catch(() => undefined);
      if (mediaDir) await this.audioStorage.removeDir(mediaDir).catch(() => undefined);
      throw error;
    }

    return this.toSummary(collection, user.name, consentAt ? user.name : null);
  }

  /** Lista as coletas da pesquisa, indicando quais têm gravação e a duração de cada uma. */
  async findAll(researchId: number, currentUser: UserPayLoad) {
    const orm = this.prisma.client.orm.public;
    const research = await orm.Research.where({ id: researchId }).first();
    this.assertCompanyAdmin(research, currentUser);

    const collections = (await orm.Collection.where({ researchId }).all())
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    const names = new Map<number, string>();
    const nameOf = async (id: number | null) => {
      if (id === null) return null;
      if (!names.has(id)) {
        const person = await orm.User.where({ id }).first();
        names.set(id, person?.name ?? '');
      }
      return names.get(id) || null;
    };

    return Promise.all(
      collections.map(async (c) =>
        this.toSummary(c, await nameOf(c.researcherId), await nameOf(c.consentConfirmedById)),
      ),
    );
  }

  /** Totais da pesquisa (recebidas, com gravação, pesquisadores, última), sem listar as coletas. */
  async stats(researchId: number, currentUser: UserPayLoad) {
    const orm = this.prisma.client.orm.public;
    const research = await orm.Research.where({ id: researchId }).first();
    this.assertCompanyAdmin(research, currentUser);

    const scoped = orm.Collection.where({ researchId });
    const total = (await scoped.aggregate((a) => ({ total: a.count() }))).total;
    const withAudio = (await scoped.where((c) => c.audioPath.isNotNull()).aggregate((a) => ({ total: a.count() }))).total;

    const researchers = new Set<number>();
    let lastAt: string | null = null;
    for (const c of await scoped.all()) {
      researchers.add(c.researcherId);
      if (!lastAt || new Date(c.startedAt).getTime() > new Date(lastAt).getTime()) lastAt = c.startedAt;
    }

    return { total, withAudio, researchers: researchers.size, lastAt };
  }

  /**
   * Lista paginada (painel web): `?page=&pageSize=&q=&audio=&sort=`. Só a página sai do servidor, e
   * só ela
   * tem os nomes resolvidos (em UMA consulta). A busca acha pelo nome do pesquisador ou pelo número
   * (#12).
   */
  async findPage(researchId: number, query: CollectionPageQueryDto, currentUser: UserPayLoad) {
    const orm = this.prisma.client.orm.public;
    const research = await orm.Research.where({ id: researchId }).first();
    this.assertCompanyAdmin(research, currentUser);

    let scoped = orm.Collection.where({ researchId });
    if (query.audio === 'AUDIO') scoped = scoped.where((c) => c.audioPath.isNotNull());
    if (query.audio === 'NO_AUDIO') scoped = scoped.where((c) => c.audioPath.isNull());

    const sorted =
      query.sort === 'name'
        ? scoped.orderBy([(c) => c.researcherId.asc(), (c) => c.id.asc()])
        : scoped.orderBy([(c) => c.startedAt.desc(), (c) => c.id.desc()]);

    type Row = Awaited<ReturnType<typeof sorted.all>>[number];

    const summarizeAll = async (rows: Row[]) => {
      const personIds = [
        ...new Set(rows.flatMap((c) => [c.researcherId, c.consentConfirmedById]).filter((id): id is number => id !== null)),
      ];
      const people = personIds.length > 0 ? [...(await orm.User.where((u) => u.id.in(personIds)).all())] : [];
      const nameById = new Map(people.map((p) => [p.id, p.name]));
      const avatarById = new Map(people.map((p) => [p.id, p.avatarUrl ?? null]));
      const nameOf = (id: number | null) => (id === null ? null : (nameById.get(id) ?? null));
      return rows.map((c) => this.toSummary(c, nameOf(c.researcherId), nameOf(c.consentConfirmedById), avatarById.get(c.researcherId) ?? null));
    };

    const params = pageParams(query);
    const term = normalizeText(query.q?.trim().replace(/^#/, ''));

    // Com texto ou ordem A-Z (o nome vem de outra tabela), a lista da pesquisa é resumida e cortada em memória.
    if (term || query.sort === 'name') {
      const all = await summarizeAll([...(await sorted.all())]);
      const matching = term
        ? all.filter((c) => normalizeText(c.researcherName).includes(term) || String(c.id).includes(term))
        : all;
      if (query.sort === 'name') {
        matching.sort((a, b) => (a.researcherName ?? '').localeCompare(b.researcherName ?? '', 'pt-BR', { sensitivity: 'base' }));
      }
      return toPage(matching.slice(params.offset, params.offset + params.pageSize), matching.length, params);
    }

    return runPaged<Awaited<ReturnType<typeof summarizeAll>>[number]>(query, {
      count: async () => (await scoped.aggregate((a) => ({ total: a.count() }))).total,
      page: async (limit, offset) => summarizeAll([...(await sorted.limit(limit).offset(offset).all())]),
      all: async () => [],
    });
  }

  /**
   * Abre uma coleta com as respostas, na ordem do questionário (seção e pergunta).
   * Perguntas sem resposta também voltam (answer: null): o administrador vê o que ficou em branco.
   */
  async findOne(id: number, currentUser: UserPayLoad) {
    const orm = this.prisma.client.orm.public;

    const collection = await orm.Collection.where({ id }).first();
    if (!collection) throw new NotFoundException('Coleta não encontrada.');

    const research = await orm.Research.where({ id: collection.researchId }).first();
    this.assertCompanyAdmin(research, currentUser);

    const researcher = await orm.User.where({ id: collection.researcherId }).first();
    const confirmedBy =
      collection.consentConfirmedById !== null
        ? await orm.User.where({ id: collection.consentConfirmedById }).first()
        : null;

    // Mais de uma resposta para a mesma pergunta não deveria ocorrer; se ocorrer, vale a mais recente.
    const answerByQuestion = new Map<number, string>();
    const answers = (await orm.Answer.where({ collectionId: collection.id }).all()).sort((a, b) => a.id - b.id);
    for (const answer of answers) answerByQuestion.set(answer.questionId, answer.value);

    const mediaNames = (await this.audioStorage.list(this.mediaDir(collection.researchId, collection.id)))
      .filter((name) => MEDIA_NAME.test(name));
    let expectedCount = 0;
    let receivedCount = 0;

    const sections = (await orm.Section.where({ researchId: collection.researchId }).all()).sort(
      (a, b) => a.order - b.order,
    );

    const detailedSections = await Promise.all(
      sections.map(async (section) => {
        const questions = (await orm.Question.where({ sectionId: section.id }).all()).sort(
          (a, b) => a.order - b.order,
        );

        const detailedQuestions = await Promise.all(
          questions.map(async (question) => {
            const options = (await orm.QuestionOption.where({ questionId: question.id }).all())
              .sort((a, b) => a.order - b.order)
              .map((option) => ({ id: option.id, text: option.text }));

            const answer = answerByQuestion.get(question.id) ?? null;
            const files = this.filesOfQuestion(mediaNames, question.id);
            const expectedFiles = FILE_QUESTION_TYPES.includes(question.type)
              ? this.expectedFilesOf(question.id, question.type, answer, mediaNames, files)
              : [];
            expectedCount += expectedFiles.length;
            receivedCount += expectedFiles.filter((file) => file.received).length;

            return {
              id: question.id,
              statement: question.statement,
              type: question.type,
              isRequired: question.isRequired,
              scaleLeftLabel: question.scaleLeftLabel ?? null,
              scaleRightLabel: question.scaleRightLabel ?? null,
              options,
              answer,
              files,
              // Quais arquivos esta resposta cita e quais já chegaram ao servidor.
              expectedFiles,
            };
          }),
        );

        return { id: section.id, title: section.title, questions: detailedQuestions };
      }),
    );

    // Áudio da entrevista: esperado quando a pesquisa grava e o entrevistado aceitou.
    const interviewExpected = !!research && research.recordInterview && collection.consentGiven;
    const interviewReceived = collection.audioPath !== null;
    if (interviewExpected) expectedCount += 1;
    if (interviewExpected && interviewReceived) receivedCount += 1;

    return {
      ...this.toSummary(collection, researcher?.name ?? null, confirmedBy?.name ?? null, researcher?.avatarUrl ?? null),
      filesSummary: {
        expected: expectedCount,
        received: receivedCount,
        missing: expectedCount - receivedCount,
        complete: expectedCount === receivedCount,
        interviewAudio: { expected: interviewExpected, received: interviewReceived },
      },
      sections: detailedSections,
    };
  }

  /**
   * Recebe UM arquivo (foto, áudio de questão ou áudio da entrevista) de uma coleta que já chegou.
   * A coleta é identificada pelo UUID do aparelho; o arquivo, pela questão e pelo nome que tem no
   * aparelho.
   */
  async uploadFile(
    clientId: string,
    dto: UploadCollectionFileDto,
    file: UploadedAudio | undefined,
    currentUser: UserPayLoad,
  ) {
    if (currentUser.profile !== 'RESEARCHER') {
      throw new ForbiddenException('Somente pesquisadores enviam arquivos de coleta.');
    }
    if (!file) throw fileRejection(BadRequestException, 'FILE_MISSING', 'Nenhum arquivo foi enviado (campo "file").', false);

    const orm = this.prisma.client.orm.public;

    // No token, `sub` é o username (não o id numérico)
    const user = await orm.User.where({ username: String(currentUser.sub) }).first();
    if (!user) throw new ForbiddenException('Usuário não encontrado.');

    // 1. A coleta precisa já ter chegado: o arquivo vai sempre depois das respostas.
    const collection = await orm.Collection.where({ researcherId: user.id, clientId: clientId.toLowerCase() }).first();
    const research = collection ? await orm.Research.where({ id: collection.researchId }).first() : null;
    if (!collection || !research || research.companyId !== currentUser.companyId) {
      throw fileRejection(
        NotFoundException,
        'COLLECTION_NOT_RECEIVED',
        'Esta coleta ainda não chegou ao servidor. Envie a coleta antes dos arquivos.',
        true,
      );
    }

    // Aparelho com a cópia revogada pelo administrador também não envia mais arquivos.
    if (await isDeviceRevoked(orm, collection.researchId, collection.deviceId)) {
      throw copyRevokedException('O administrador revogou o acesso deste aparelho a esta pesquisa. O arquivo não foi aceito.');
    }

    const name = dto.name.trim();
    const mediaDir = this.mediaDir(collection.researchId, collection.id);

    // 2. Áudio da entrevista (sem questão) ou arquivo de uma questão.
    const isInterview = dto.questionId === undefined || dto.questionId === null;
    let questionType: string | null = null;
    if (isInterview) {
      if (!research.recordInterview || !collection.consentGiven) {
        throw fileRejection(
          BadRequestException,
          'FILE_NOT_EXPECTED',
          'Esta coleta não tem gravação de entrevista: o áudio foi recusado.',
          false,
        );
      }
    } else {
      const questionTypes = await this.loadQuestionTypes(research.id);
      questionType = questionTypes.get(dto.questionId!) ?? null;
      if (!questionType) {
        throw fileRejection(BadRequestException, 'QUESTION_NOT_FOUND', `A questão ${dto.questionId} não pertence a esta pesquisa.`, false);
      }
      if (!FILE_QUESTION_TYPES.includes(questionType)) {
        throw fileRejection(BadRequestException, 'FILE_NOT_EXPECTED', `A questão ${dto.questionId} não recebe arquivo.`, false);
      }
      // O arquivo precisa ser um dos que a resposta da coleta cita.
      const answers = (await orm.Answer.where({ collectionId: collection.id, questionId: dto.questionId! }).all())
        .sort((a, b) => a.id - b.id);
      const cited = answerFileNames(questionType, answers.at(-1)?.value ?? null);
      if (!cited.some((citedName) => fileStem(citedName) === fileStem(name))) {
        throw fileRejection(
          BadRequestException,
          'FILE_NOT_EXPECTED',
          `O arquivo "${name}" não consta na resposta da questão ${dto.questionId} desta coleta.`,
          false,
        );
      }
    }

    const isAudio = isInterview || questionType === 'AUDIO';

    // 3. Já recebido: não grava de novo.
    if (isInterview) {
      if (collection.audioPath) return this.fileResult('ALREADY_EXISTS', collection.audioMimeType ?? 'audio/mp4', collection.audioSizeBytes ?? 0, null);
    } else {
      const stem = fileStem(name);
      const already = (await this.audioStorage.list(mediaDir)).find((stored) => {
        const match = MEDIA_NAME.exec(stored);
        return match !== null && Number(match[1]) === dto.questionId && match[2] === stem;
      });
      if (already) return this.fileResult('ALREADY_EXISTS', mediaTypeFor(already) ?? file.mimetype, file.size, already);
    }

    // 4. Tipo e tamanho (limites do servidor).
    const extension = isAudio ? audioExtensionFor(file.mimetype) : imageExtensionFor(file.mimetype);
    if (!extension) {
      throw fileRejection(BadRequestException, 'UNSUPPORTED_TYPE', `Formato de ${isAudio ? 'áudio' : 'foto'} não suportado (${file.mimetype || 'sem tipo'}).`, false);
    }
    if (!file.size || file.buffer.length === 0) {
      throw fileRejection(BadRequestException, 'EMPTY_FILE', 'O arquivo está vazio.', false);
    }
    const maxBytes = isAudio ? audioMaxBytes() : photoMaxBytes();
    if (file.buffer.length > maxBytes) {
      throw fileRejection(
        BadRequestException,
        'FILE_TOO_LARGE',
        `O arquivo passa do tamanho máximo permitido para ${isAudio ? 'áudio' : 'foto'} (${formatLimit(maxBytes)}).`,
        false,
      );
    }
    if (!(isAudio ? looksLikeAudio(file.buffer) : looksLikeImage(file.buffer))) {
      throw fileRejection(BadRequestException, 'INVALID_CONTENT', `O conteúdo do arquivo não é ${isAudio ? 'um áudio' : 'uma foto'} válido.`, false);
    }

    // 5. Grava.
    if (isInterview) {
      const audioPath = await this.audioStorage.save(research.id, file.buffer, extension);
      try {
        await orm.Collection.where({ id: collection.id }).update({
          audioPath,
          audioMimeType: file.mimetype,
          audioSizeBytes: file.buffer.length,
          audioDurationSeconds: dto.durationSeconds ?? null,
        });
      } catch (error) {
        await this.audioStorage.remove(audioPath).catch(() => undefined);
        throw error;
      }
      return this.fileResult('ACCEPTED', file.mimetype, file.buffer.length, null);
    }

    const stored = storedFileName(dto.questionId!, name, extension);
    await this.audioStorage.saveAt(`${mediaDir}/${stored}`, file.buffer);
    return this.fileResult('ACCEPTED', file.mimetype, file.buffer.length, stored);
  }

  /** Monta a resposta do envio de um arquivo (aceito ou já existente). */
  private fileResult(status: 'ACCEPTED' | 'ALREADY_EXISTS', mimeType: string, sizeBytes: number, storedName: string | null) {
    return { status, file: { name: storedName, mimeType, sizeBytes } };
  }

  /** Abre uma foto ou um áudio de resposta. Só administrador da empresa dona da pesquisa chega aqui. */
  async getMedia(id: number, name: string, currentUser: UserPayLoad) {
    const orm = this.prisma.client.orm.public;

    const mimeType = MEDIA_NAME.test(name) ? mediaTypeFor(name) : null;
    if (!mimeType) throw new NotFoundException('Arquivo não encontrado.');

    const collection = await orm.Collection.where({ id }).first();
    if (!collection) throw new NotFoundException('Coleta não encontrada.');

    const research = await orm.Research.where({ id: collection.researchId }).first();
    this.assertCompanyAdmin(research, currentUser);

    const file = await this.audioStorage.open(`${this.mediaDir(collection.researchId, collection.id)}/${name}`);
    if (!file) throw new NotFoundException('O arquivo não foi encontrado.');

    return { ...file, mimeType };
  }

  /** Abre o áudio de uma coleta. Só administrador da empresa dona da pesquisa chega aqui. */
  async getAudio(id: number, currentUser: UserPayLoad) {
    const orm = this.prisma.client.orm.public;

    const collection = await orm.Collection.where({ id }).first();
    if (!collection) throw new NotFoundException('Coleta não encontrada.');

    const research = await orm.Research.where({ id: collection.researchId }).first();
    this.assertCompanyAdmin(research, currentUser);

    if (!collection.audioPath) throw new NotFoundException('Esta coleta não tem gravação.');

    const file = await this.audioStorage.open(collection.audioPath);
    if (!file) throw new NotFoundException('O arquivo de áudio desta coleta não foi encontrado.');

    return { ...file, mimeType: collection.audioMimeType ?? 'audio/mp4' };
  }

  /** O áudio é dado pessoal: apenas administrador da empresa da pesquisa lista as coletas e ouve. */
  private assertCompanyAdmin(research: { companyId: number } | null | undefined, currentUser: UserPayLoad) {
    if (
      !research ||
      currentUser.profile !== 'ADMINISTRATOR' ||
      !currentUser.companyId ||
      research.companyId !== currentUser.companyId
    ) {
      throw new ForbiddenException('Acesso negado: somente administradores da empresa desta pesquisa acessam as coletas e os áudios.');
    }
  }

  /** Pasta onde ficam os arquivos das respostas de uma coleta. */
  private mediaDir(researchId: number, collectionId: number): string {
    return `${researchId}/answers/${collectionId}`;
  }

  /** Arquivos guardados de uma questão, na ordem em que foram enviados. */
  private filesOfQuestion(mediaNames: string[], questionId: number) {
    return mediaNames
      .map((name) => ({ name, match: MEDIA_NAME.exec(name) }))
      .filter((item) => item.match !== null && Number(item.match[1]) === questionId)
      .sort((a, b) => {
        const left = a.match![2];
        const right = b.match![2];
        const leftNumber = /^\d+$/.test(left);
        const rightNumber = /^\d+$/.test(right);
        if (leftNumber && rightNumber) return Number(left) - Number(right);
        if (leftNumber !== rightNumber) return leftNumber ? -1 : 1; // envio antigo primeiro
        return left.localeCompare(right);
      })
      .map((item) => ({ name: item.name, mimeType: mediaTypeFor(item.name) ?? 'application/octet-stream' }));
  }

  /**
   * Arquivos que a resposta cita, cada um com "chegou ou não". O arquivo chegou se existe com o
   * identificador
   * do nome (envio separado) ou, nas coletas antigas, na mesma posição da lista (envio junto da
   * coleta).
   */
  private expectedFilesOf(
    questionId: number,
    type: string,
    answer: string | null,
    mediaNames: string[],
    files: { name: string; mimeType: string }[],
  ) {
    const legacy = files.filter((file) => /^\d+$/.test(MEDIA_NAME.exec(file.name)?.[2] ?? ''));
    return answerFileNames(type, answer).map((deviceName, index) => {
      const stem = fileStem(deviceName);
      const storedName = mediaNames.find((stored) => {
        const match = MEDIA_NAME.exec(stored);
        return match !== null && Number(match[1]) === questionId && match[2] === stem;
      });
      const file = storedName
        ? { name: storedName, mimeType: mediaTypeFor(storedName) ?? 'application/octet-stream' }
        : (legacy[index] ?? null);
      return { name: deviceName, received: file !== null, file };
    });
  }

  /** Mapa questão -> tipo, de todas as questões da pesquisa. */
  private async loadQuestionTypes(researchId: number): Promise<Map<number, string>> {
    const orm = this.prisma.client.orm.public;
    const types = new Map<number, string>();
    const sections = await orm.Section.where({ researchId }).all();
    for (const section of sections) {
      for (const question of await orm.Question.where({ sectionId: section.id }).all()) {
        types.set(question.id, question.type);
      }
    }
    return types;
  }

  /** Recusa respostas de questões que não pertencem à pesquisa. */
  private assertAnswersBelongToResearch(questionTypes: Map<number, string>, answers: { questionId: number }[]) {
    const stray = answers.find((a) => !questionTypes.has(a.questionId));
    if (stray) throw new BadRequestException(`A questão ${stray.questionId} não pertence a esta pesquisa.`);
  }

  /**
   * Confere fotos e áudios de questão com a lista do payload (mesma ordem) e decide o nome de cada
   * arquivo.
   * Nada vai para o disco aqui: só depois de tudo validado.
   */
  private planMedia(
    questionTypes: Map<number, string>,
    payload: CollectionPayloadDto,
    media: UploadedMedia,
  ): { fileName: string; buffer: Buffer }[] {
    const groups = [
      {
        label: 'foto',
        refs: payload.photos ?? [],
        files: media.photos ?? [],
        accepts: ['PHOTO', 'MULTIPLE_PHOTOS'],
        extensionFor: imageExtensionFor,
        maxBytes: MAX_PHOTO_BYTES,
      },
      {
        label: 'áudio',
        refs: payload.questionAudios ?? [],
        files: media.questionAudios ?? [],
        accepts: ['AUDIO'],
        extensionFor: audioExtensionFor,
        maxBytes: Infinity,
      },
    ];

    const planned: { fileName: string; buffer: Buffer }[] = [];

    for (const group of groups) {
      if (group.refs.length !== group.files.length) {
        throw new BadRequestException(`Os arquivos de ${group.label} enviados não conferem com a lista da coleta.`);
      }

      const perQuestion = new Map<number, number>();
      group.refs.forEach((ref, index) => {
        const type = questionTypes.get(ref.questionId);
        if (!type) throw new BadRequestException(`A questão ${ref.questionId} não pertence a esta pesquisa.`);
        if (!group.accepts.includes(type)) {
          throw new BadRequestException(`A questão ${ref.questionId} não recebe arquivo de ${group.label}.`);
        }

        const file = group.files[index];
        const extension = group.extensionFor(file.mimetype);
        if (!extension) throw new BadRequestException(`Formato de ${group.label} não suportado.`);
        if (!file.size || file.buffer.length === 0) {
          throw new BadRequestException(`Um arquivo de ${group.label} está vazio.`);
        }
        if (file.buffer.length > group.maxBytes) {
          throw new BadRequestException(`Um arquivo de ${group.label} passa do tamanho máximo permitido.`);
        }

        const position = perQuestion.get(ref.questionId) ?? 0;
        perQuestion.set(ref.questionId, position + 1);
        planned.push({ fileName: `q${ref.questionId}-${position}.${extension}`, buffer: file.buffer });
      });
    }

    return planned;
  }

  /** Converte uma coleta no resumo usado nas listas. */
  private toSummary(
    collection: {
      id: number;
      researchId: number;
      researcherId: number;
      startedAt: string;
      finishedAt: string;
      receivedAt: string;
      consentGiven: boolean;
      consentAt: string | null;
      consentConfirmedById: number | null;
      audioPath: string | null;
      audioDurationSeconds: number | null;
      audioSizeBytes: number | null;
    },
    researcherName: string | null,
    consentConfirmedByName: string | null,
    researcherAvatarUrl: string | null = null,
  ) {
    return {
      id: collection.id,
      researchId: collection.researchId,
      researcherId: collection.researcherId,
      researcherName,
      researcherAvatarUrl,
      startedAt: collection.startedAt,
      finishedAt: collection.finishedAt,
      receivedAt: collection.receivedAt,
      consent: {
        given: collection.consentGiven,
        at: collection.consentAt,
        confirmedById: collection.consentConfirmedById,
        confirmedByName: consentConfirmedByName,
      },
      hasAudio: collection.audioPath !== null,
      audioDurationSeconds: collection.audioDurationSeconds,
      audioSizeBytes: collection.audioSizeBytes,
    };
  }
}

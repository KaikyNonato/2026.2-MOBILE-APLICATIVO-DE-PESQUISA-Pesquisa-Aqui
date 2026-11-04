import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { AudioStorage } from '../collection/audio-storage.js';
import { CreateResearchDto, ResearchStatus } from './dto/create-research.dto.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { normalizeText, pageParams, runPaged, toPage, type CopiesPageQueryDto, type Page, type ResearchPageQueryDto, type TeamPageQueryDto } from '../common/pagination.js';
import { UpdateResearchDto } from './dto/update-research.dto.js';
import {
  assertStructureEditable,
  copyRevokedException,
  copyStatus,
  copyStatusOf,
  countDownloads,
  getLockState,
  isDeviceRevoked,
  registerCopy,
  returnCopy,
  revokeCopy,
  unblockDevice,
  type CopyRow,
} from './research-copies.js';

const ALLOWED_TRANSITIONS: Record<ResearchStatus, ResearchStatus[]> = {
  [ResearchStatus.DRAFT]: [ResearchStatus.PUBLISHED],
  [ResearchStatus.PUBLISHED]: [ResearchStatus.IN_FIELD],
  [ResearchStatus.IN_FIELD]: [ResearchStatus.CLOSED],
  [ResearchStatus.CLOSED]: [], // estado final, sem saída
};

/**
 * Confere se a mudança de situação da pesquisa é permitida (rascunho, publicada, em campo,
 * encerrada).
 */
function assertValidTransition(current: ResearchStatus, next: ResearchStatus) {
  if (current === next) return;

  const allowed = ALLOWED_TRANSITIONS[current];

  if (!allowed.includes(next)) {
    throw new BadRequestException(
      `Invalid status transition: cannot move from ${current} to ${next}`
    );
  }
}

/**
 * Regras de pesquisas: cadastro, listagem por perfil, publicação, edição, exclusão, vínculo de
 * pesquisadores, cópias baixadas nos aparelhos e pacote de download.
 */
@Injectable()
export class ResearchService {
  private readonly logger = new Logger(ResearchService.name);

  constructor(private prisma: PrismaService, private audioStorage: AudioStorage) { }

  /**
   * Cria uma pesquisa em rascunho. O superadministrador informa a empresa; o administrador usa a
   * própria.
   */
  async create(createResearchDto: CreateResearchDto, currentUser: UserPayLoad) {
    if (new Date(createResearchDto.endDate) < new Date(createResearchDto.startDate)) throw new BadRequestException('The end date cannot be earlier than the start date');

    let companyId = currentUser.companyId;

    if (currentUser.profile === 'SUPERADMINISTRATOR') {
      if (!createResearchDto.companyId) throw new BadRequestException('The company ID is required for super administrators');
      companyId = createResearchDto.companyId;
    }

    if (!companyId) throw new ForbiddenException('User is not associated with a company');

    return await this.prisma.client.orm.public.Research.create({
      title: createResearchDto.title,
      description: createResearchDto.description,
      objective: createResearchDto.objective,
      startDate: createResearchDto.startDate,
      endDate: createResearchDto.endDate,
      targetAudience: createResearchDto.targetAudience,
      status: 'DRAFT',
      recordInterview: createResearchDto.recordInterview ?? false,
      areaLatitude: createResearchDto.areaLatitude ?? null,
      areaLongitude: createResearchDto.areaLongitude ?? null,
      areaRadiusKm: createResearchDto.areaRadiusKm ?? null,
      companyId: companyId,
    });
  }

  /** No token, `sub` é o username (não o id numérico). */
  private async currentUserRecord(currentUser: UserPayLoad) {
    return this.prisma.client.orm.public.User.where({ username: String(currentUser.sub) }).first();
  }

  /** Pesquisador só enxerga pesquisa publicada, da própria empresa e à qual esteja vinculado. */
  private async isVisibleToResearcher(
    research: { id: number; status: string; companyId: number },
    currentUser: UserPayLoad,
  ): Promise<boolean> {
    if (research.status === ResearchStatus.DRAFT) return false;
    if (!currentUser.companyId || research.companyId !== currentUser.companyId) return false;

    const user = await this.currentUserRecord(currentUser);
    if (!user) return false;

    const link = await this.prisma.client.orm.public.ResearchResearcher.where({ researchId: research.id, userId: user.id }).first();
    return !!link;
  }

  /**
   * Lista as pesquisas visíveis ao usuário: todas (superadministrador), as da empresa
   * (administrador) ou, para o pesquisador, as publicadas às quais ele está vinculado, com
   * progresso e situação da cópia no aparelho.
   */
  async findAll(currentUser: UserPayLoad, deviceId?: string) {
    if (currentUser.profile === 'SUPERADMINISTRATOR') return this.prisma.client.orm.public.Research.all();

    if (!currentUser.companyId) throw new ForbiddenException('User is not associated with a company');

    if (currentUser.profile === 'RESEARCHER') {
      const orm = this.prisma.client.orm.public;
      const user = await this.currentUserRecord(currentUser);
      if (!user) return [];

      // Sem vínculo, a pesquisa não aparece: a lista parte dos vínculos do pesquisador.
      const links = await orm.ResearchResearcher.where({ userId: user.id }).all();
      const researches = await Promise.all(links.map((link) => orm.Research.where({ id: link.researchId }).first()));

      const visible = researches.filter(
        (r): r is NonNullable<typeof r> =>
          !!r && r.status !== ResearchStatus.DRAFT && r.companyId === currentUser.companyId,
      );

      // O pesquisador vê o próprio progresso: a meta do vínculo (`targetCount`, nulo = sem meta), quantas
      // coletas dele o servidor já recebeu (`collected`) e os identificadores delas (`collectedIds`).
      // Com os identificadores o app não conta duas vezes a coleta que está no servidor e ainda no aparelho.
      const withProgress = await Promise.all(
        visible.map(async (r) => {
          const link = links.find((l) => l.researchId === r.id);
          const received = await orm.Collection.where({ researchId: r.id, researcherId: user.id }).all();
          const collectedIds = received
            .map((c: { clientId?: string | null }) => c.clientId?.toLowerCase())
            .filter((id: string | undefined): id is string => !!id);
          return { ...r, targetCount: link?.targetCount ?? null, collected: received.length, collectedIds };
        }),
      );

      // Com o aparelho identificado, cada pesquisa diz se a cópia dele ainda vale (ACTIVE) ou foi
      // devolvida/revogada: é assim que o app descobre que o administrador revogou o acesso.
      if (!deviceId) return withProgress;
      return Promise.all(
        withProgress.map(async (r) => ({ ...r, copyStatus: await copyStatusOf(orm, r.id, user.id, deviceId) })),
      );
    }

    return await this.prisma.client.orm.public.Research.where({ companyId: currentUser.companyId }).all();
  }

  /**
   * Lista paginada (painel web): só a página pedida sai do servidor. Pesquisador continua na lista
   * antiga.
   */
  async findPage(query: ResearchPageQueryDto, currentUser: UserPayLoad) {
    const scoped = this.scopedResearches(currentUser);
    const filtered = query.status ? scoped.where({ status: query.status }) : scoped;
    const sorted =
      query.sort === 'name'
        ? filtered.orderBy([(r) => r.title.asc(), (r) => r.id.asc()])
        : query.sort === 'deadline'
          ? filtered.orderBy([(r) => r.endDate.asc(), (r) => r.id.asc()])
          : filtered.orderBy([(r) => r.createdAt.desc(), (r) => r.id.desc()]);

    type Row = Awaited<ReturnType<typeof sorted.all>>[number];
    const page: Page<Row> = await runPaged<Row>(query, {
      count: async () => (await filtered.aggregate((a) => ({ total: a.count() }))).total,
      page: async (limit, offset) => [...(await sorted.limit(limit).offset(offset).all())],
      all: async () => [...(await sorted.all())],
      searchText: (r) => `${r.title} ${r.objective} ${r.targetAudience}`,
    });

    // Só para as pesquisas desta página, em 3 consultas no total (e não uma ou mais por pesquisa):
    // coletas recebidas (contadas e agrupadas no banco), vínculos e as pessoas da equipe.
    const orm = this.prisma.client.orm.public;
    const ids = page.items.map((research) => research.id);
    const TEAM_LIMIT = 50;

    const collectedByResearch = new Map<number, number>();
    const downloadedIds = new Set<number>();
    const teamByResearch = new Map<number, { id: number; name: string; username: string; avatarUrl: string | null }[]>();

    if (ids.length > 0) {
      const counts = await orm.Collection.where((c) => c.researchId.in(ids))
        .groupBy('researchId')
        .aggregate((a) => ({ total: a.count() }));
      for (const row of counts) collectedByResearch.set(row.researchId, row.total);

      // Pesquisas desta página que já foram baixadas por algum pesquisador (não podem ser excluídas).
      const downloads = [...(await orm.ResearchDownload.where((d) => d.researchId.in(ids)).all())];
      for (const download of downloads) downloadedIds.add(download.researchId);

      const links = [...(await orm.ResearchResearcher.where((l) => l.researchId.in(ids)).all())];
      const userIds = [...new Set(links.map((link) => link.userId))];
      const users = userIds.length > 0 ? [...(await orm.User.where((u) => u.id.in(userIds)).all())] : [];
      const userById = new Map(users.map((user) => [user.id, user]));

      for (const link of links) {
        const user = userById.get(link.userId);
        if (!user) continue;
        const team = teamByResearch.get(link.researchId) ?? [];
        if (team.length < TEAM_LIMIT) team.push({ id: user.id, name: user.name, username: user.username, avatarUrl: user.avatarUrl ?? null });
        teamByResearch.set(link.researchId, team);
      }
    }

    const items = page.items.map((research) => ({
      ...research,
      collected: collectedByResearch.get(research.id) ?? 0,
      team: teamByResearch.get(research.id) ?? [],
      canDelete: !downloadedIds.has(research.id),
    }));

    return { ...page, items };
  }

  /** Quantas pesquisas há em cada situação (legenda da tela de pesquisas), sem trazer as pesquisas. */
  async summary(currentUser: UserPayLoad) {
    const scoped = this.scopedResearches(currentUser);
    const statuses = ['DRAFT', 'PUBLISHED', 'IN_FIELD', 'CLOSED'] as const;
    const counts = await Promise.all(
      statuses.map(async (status) => (await scoped.where({ status }).aggregate((a) => ({ total: a.count() }))).total),
    );
    const byStatus = Object.fromEntries(statuses.map((status, i) => [status, counts[i]])) as Record<(typeof statuses)[number], number>;
    // Coletas recebidas em todas as pesquisas do escopo (uma consulta só, sem listar nada).
    const ids = [...(await scoped.all())].map((r) => r.id);
    const collections =
      ids.length === 0
        ? 0
        : (await this.prisma.client.orm.public.Collection.where((c) => c.researchId.in(ids)).aggregate((a) => ({ total: a.count() }))).total;
    return { total: counts.reduce((sum, n) => sum + n, 0), byStatus, collections };
  }

  /** Consulta de pesquisas já restrita ao escopo do usuário (todas, ou só as da empresa dele). */
  private scopedResearches(currentUser: UserPayLoad) {
    const research = this.prisma.client.orm.public.Research;
    if (currentUser.profile === 'SUPERADMINISTRATOR') return research.where((r) => r.id.gt(0));
    if (!currentUser.companyId) throw new ForbiddenException('User is not associated with a company');
    const companyId = currentUser.companyId;
    return research.where((r) => r.companyId.eq(companyId));
  }

  /**
   * Busca uma pesquisa respeitando o escopo do usuário. Lança 404 se não existir ou se for de outra
   * empresa.
   */
  async findOne(id: number, currentUser: UserPayLoad) {
    if (currentUser.profile === 'SUPERADMINISTRATOR') {
      const research = await this.prisma.client.orm.public.Research.where({ id }).first();
      if (!research) throw new NotFoundException('Research not found');
      return research;
    }

    const research = await this.prisma.client.orm.public.Research.where({ id, companyId: currentUser.companyId }).first();

    if (!research) throw new ForbiddenException('Access denied: this research belongs to another company or does not exist');

    // Pesquisador não vinculado não enxerga a pesquisa (nem sabe que ela existe).
    if (currentUser.profile === 'RESEARCHER' && !(await this.isVisibleToResearcher(research, currentUser))) {
      throw new NotFoundException('Research not found');
    }

    return research;
  }

  /** Detalhe para a tela: a pesquisa + estado da trava (`locked`, motivo e quantas cópias ativas). */
  async findOneWithLock(id: number, currentUser: UserPayLoad) {
    const research = await this.findOne(id, currentUser);
    const lock = await getLockState(this.prisma.client.orm.public, research);
    return {
      ...research,
      locked: lock.locked,
      lockReason: lock.reason,
      lockMessage: lock.message,
      activeCopies: lock.activeCopies,
      // Nenhum pesquisador baixou a pesquisa: ainda dá para excluir.
      canDelete: (await countDownloads(this.prisma.client.orm.public, id)) === 0,
    };
  }

  /**
   * Estrutura travada = há ao menos uma cópia ativa (ou a pesquisa está encerrada).
   * É calculado na hora a partir das cópias: devolvida a última, destrava sozinho.
   */
  async isLocked(research: { id: number; status: string }): Promise<boolean> {
    return (await getLockState(this.prisma.client.orm.public, research)).locked;
  }

  /**
   * Porta única de toda escrita na ESTRUTURA do questionário (seção, questão, opção, validação, ordem,
   * regra de pulo, gravação). Lança 403 se travada; devolve a pesquisa para quem quiser reaproveitar.
   * O que NÃO passa por aqui continua liberado: vincular pesquisador, meta, prazo, status, relatórios.
   */
  async assertEditable(researchId: number, currentUser: UserPayLoad) {
    const research = await this.findOne(researchId, currentUser);
    await assertStructureEditable(this.prisma.client.orm.public, research);
    return research;
  }

  /**
   * Edita uma pesquisa. Pesquisa encerrada não muda, e a configuração de gravação trava enquanto
   * houver cópias ativas.
   */
  async update(id: number, updateResearchDto: UpdateResearchDto, currentUser: UserPayLoad) {
    const research = await this.findOne(id, currentUser);

    if (research.status === ResearchStatus.CLOSED) throw new BadRequestException('Closed research cannot be modified');

    // Só a configuração de gravação é estrutura do questionário (muda o que o aplicativo exige e coleta):
    // com cópia ativa ela não pode ser ligada nem desligada. Título, descrição, público, datas (prorrogar
    // o prazo) e status não mexem na estrutura e continuam liberados com a trava ligada.
    if (
      updateResearchDto.recordInterview !== undefined &&
      updateResearchDto.recordInterview !== research.recordInterview
    ) {
      await assertStructureEditable(this.prisma.client.orm.public, research);
    }

    if (updateResearchDto.startDate && updateResearchDto.endDate) {
      if (new Date(updateResearchDto.endDate) < new Date(updateResearchDto.startDate)) throw new BadRequestException('The end date cannot be earlier than the start date');
    }

    if (updateResearchDto.status) {
      assertValidTransition(research.status as ResearchStatus, updateResearchDto.status);

      if (updateResearchDto.status === ResearchStatus.PUBLISHED && research.status !== ResearchStatus.PUBLISHED) {
        if (currentUser.profile === 'RESEARCHER') throw new ForbiddenException('Researchers cannot publish research');
        await this.assertHasQuestions(id);
      }
    }

    // A área-alvo só vale completa: centro e raio juntos, ou nenhum dos três.
    const area = [updateResearchDto.areaLatitude, updateResearchDto.areaLongitude, updateResearchDto.areaRadiusKm];
    if (area.some((v) => v !== undefined)) {
      const merged = [
        updateResearchDto.areaLatitude !== undefined ? updateResearchDto.areaLatitude : research.areaLatitude,
        updateResearchDto.areaLongitude !== undefined ? updateResearchDto.areaLongitude : research.areaLongitude,
        updateResearchDto.areaRadiusKm !== undefined ? updateResearchDto.areaRadiusKm : research.areaRadiusKm,
      ];
      const filled = merged.filter((v) => v !== null && v !== undefined).length;
      if (filled !== 0 && filled !== 3) throw new BadRequestException('Informe latitude, longitude e raio da área-alvo juntos (ou nenhum deles).');
    }

    return await this.prisma.client.orm.public.Research.where({ id }).update(updateResearchDto);
  }

  /** Publicar: DRAFT -> PUBLISHED. A partir daqui a pesquisa fica visível para o app. */
  async publish(id: number, currentUser: UserPayLoad) {
    if (currentUser.profile === 'RESEARCHER') throw new ForbiddenException('Researchers cannot publish research');

    const research = await this.findOne(id, currentUser);

    if (research.status !== ResearchStatus.DRAFT) {
      throw new BadRequestException(`Only draft research can be published (current status: ${research.status})`);
    }

    await this.assertHasQuestions(id);

    return await this.prisma.client.orm.public.Research.where({ id }).update({ status: ResearchStatus.PUBLISHED });
  }

  /**
   * Voltar para rascunho: PUBLISHED -> DRAFT. Só enquanto nenhum pesquisador baixou a pesquisa
   * (mesma condição da exclusão): depois do primeiro download ela já pode ter coletas em campo.
   */
  async unpublish(id: number, currentUser: UserPayLoad) {
    if (currentUser.profile === 'RESEARCHER') throw new ForbiddenException('Researchers cannot unpublish research');

    const research = await this.findOne(id, currentUser);

    if (research.status !== ResearchStatus.PUBLISHED) {
      throw new BadRequestException(`Only published research can go back to draft (current status: ${research.status})`);
    }

    if ((await countDownloads(this.prisma.client.orm.public, id)) > 0) {
      throw new BadRequestException('Esta pesquisa já foi baixada por pesquisadores e não pode voltar para rascunho.');
    }

    return await this.prisma.client.orm.public.Research.where({ id }).update({ status: ResearchStatus.DRAFT });
  }

  /**
   * Encerrar (W12): a pesquisa vira CLOSED, estado final. A partir daqui a API recusa coleta nova
   * (sincronização e envio direto) e a pesquisa não é mais editada nem baixada: o resultado fica congelado.
   * Vale para pesquisa publicada ou em campo; rascunho nunca foi a campo, então não há o que encerrar.
   * Idempotente: encerrar de novo devolve a pesquisa como está.
   */
  async close(id: number, currentUser: UserPayLoad) {
    if (currentUser.profile !== 'ADMINISTRATOR') throw new ForbiddenException('Somente o administrador da empresa encerra a pesquisa.');

    const research = await this.findOne(id, currentUser);

    if (research.status === ResearchStatus.CLOSED) return research;
    if (research.status === ResearchStatus.DRAFT) {
      throw new BadRequestException('Uma pesquisa em rascunho não pode ser encerrada: publique-a ou exclua-a.');
    }

    const closed = await this.prisma.client.orm.public.Research.where({ id }).update({ status: ResearchStatus.CLOSED });
    this.logger.warn(`Pesquisa ${id} encerrada por ${currentUser.username ?? currentUser.sub}`);
    return closed;
  }

  /** Pesquisa sem nenhuma questão não pode ser publicada */
  private async assertHasQuestions(researchId: number) {
    const orm = this.prisma.client.orm.public;
    const sections = await orm.Section.where({ researchId }).all();

    for (const section of sections) {
      const first = await orm.Question.where({ sectionId: section.id }).first();
      if (first) return;
    }

    throw new BadRequestException('A research without questions cannot be published');
  }

  // ---------- vínculo pesquisador <-> pesquisa ----------

  /**
   * Quem está vinculado à pesquisa, com a meta e quanto cada um já entregou.
   * `collected` conta as coletas recebidas do pesquisador nesta pesquisa; `remaining` e `progress`
   * só existem quando há meta (`targetCount` nulo = sem meta definida).
   */
  async listResearchers(researchId: number, currentUser: UserPayLoad) {
    if (currentUser.profile === 'RESEARCHER') throw new ForbiddenException('Researchers cannot list linked researchers');

    await this.findOne(researchId, currentUser);
    const orm = this.prisma.client.orm.public;

    const links = await orm.ResearchResearcher.where({ researchId }).all();
    const collections = await orm.Collection.where({ researchId }).all();

    const collectedBy = new Map<number, number>();
    for (const c of collections) collectedBy.set(c.researcherId, (collectedBy.get(c.researcherId) ?? 0) + 1);

    const rows = await Promise.all(
      links.map(async (link) => {
        const user = await orm.User.where({ id: link.userId }).first();
        const collected = collectedBy.get(link.userId) ?? 0;
        const targetCount = link.targetCount ?? null;

        return {
          id: link.id,
          researchId: link.researchId,
          userId: link.userId,
          name: user?.name ?? null,
          username: user?.username ?? null,
          avatarUrl: user?.avatarUrl ?? null,
          situation: user?.situation ?? null,
          targetCount,
          collected,
          remaining: targetCount === null ? null : Math.max(0, targetCount - collected),
          progress: targetCount === null ? null : Math.min(100, Math.round((collected / targetCount) * 100)),
          createdAt: link.createdAt,
        };
      }),
    );

    return rows.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR', { sensitivity: 'base' }));
  }

  /**
   * Pesquisadores da empresa da pesquisa, com o vínculo de cada um (se houver), em PÁGINAS:
   * vinculados primeiro,
   * depois a ordem pedida. Traz também o resumo da equipe (total, vinculados e as 5 primeiras
   * pessoas).
   */
  async teamPage(researchId: number, query: TeamPageQueryDto, currentUser: UserPayLoad) {
    if (currentUser.profile === 'RESEARCHER') throw new ForbiddenException('Researchers cannot list linked researchers');

    const research = await this.findOne(researchId, currentUser);
    const orm = this.prisma.client.orm.public;

    const members = [...(await orm.User.where({ profile: 'RESEARCHER', companyId: research.companyId }).all())];
    const linkRows = await this.listResearchers(researchId, currentUser);
    const linkByUser = new Map(linkRows.map((link) => [link.userId, link]));

    const rows = members.map((user) => {
      const { passwordHash: _, ...safe } = user;
      return { ...safe, link: linkByUser.get(user.id) ?? null };
    });

    const term = normalizeText(query.q?.trim());
    let visible = rows.filter((row) => {
      if (query.filter === 'LINKED' && !row.link) return false;
      if (query.filter === 'AVAILABLE' && row.link) return false;
      return !term || normalizeText(`${row.name} ${row.username}`).includes(term);
    });

    visible = visible.sort((a, b) => {
      const group = (a.link ? 0 : 1) - (b.link ? 0 : 1);
      if (group !== 0) return group;
      if (query.sort === 'name') return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const params = pageParams(query);
    const linkedMembers = rows.filter((row) => row.link);

    return {
      ...toPage(visible.slice(params.offset, params.offset + params.pageSize), visible.length, params),
      summary: {
        total: rows.length,
        linked: linkedMembers.length,
        linkedPreview: linkedMembers.slice(0, 5).map((row) => ({ id: row.id, name: row.name, avatarUrl: row.avatarUrl ?? null })),
      },
    };
  }

  /**
   * Vincula o pesquisador à pesquisa, com a meta de coletas. Se já estava vinculado, só atualiza a
   * meta (quando enviada).
   */
  async addResearcher(researchId: number, userId: number, currentUser: UserPayLoad, targetCount?: number) {
    if (currentUser.profile === 'RESEARCHER') throw new ForbiddenException('Researchers cannot link researchers');

    const research = await this.findOne(researchId, currentUser);
    const orm = this.prisma.client.orm.public;

    const user = await orm.User.where({ id: userId }).first();
    if (!user || user.profile !== 'RESEARCHER') throw new NotFoundException('Researcher not found');
    if (user.companyId !== research.companyId) throw new BadRequestException('The researcher belongs to another company');

    const existing = await orm.ResearchResearcher.where({ researchId, userId }).first();
    if (existing) {
      if (targetCount === undefined || targetCount === existing.targetCount) return existing;
      return await orm.ResearchResearcher.where({ id: existing.id }).update({ targetCount });
    }

    return await orm.ResearchResearcher.create({ researchId, userId, targetCount: targetCount ?? null });
  }

  /**
   * Altera a meta de um vínculo existente. Vale em qualquer fase: a pesquisa em campo não trava a
   * meta.
   */
  async updateResearcherTarget(researchId: number, userId: number, targetCount: number, currentUser: UserPayLoad) {
    if (currentUser.profile === 'RESEARCHER') throw new ForbiddenException('Researchers cannot change targets');

    await this.findOne(researchId, currentUser);
    const orm = this.prisma.client.orm.public;

    const link = await orm.ResearchResearcher.where({ researchId, userId }).first();
    if (!link) throw new NotFoundException('The researcher is not linked to this research');

    return await orm.ResearchResearcher.where({ id: link.id }).update({ targetCount });
  }

  /**
   * Desvincular remove só o vínculo: as coletas já recebidas do pesquisador (Collection) continuam
   * na pesquisa.
   */
  async removeResearcher(researchId: number, userId: number, currentUser: UserPayLoad) {
    if (currentUser.profile === 'RESEARCHER') throw new ForbiddenException('Researchers cannot unlink researchers');

    await this.findOne(researchId, currentUser);
    return await this.prisma.client.orm.public.ResearchResearcher.where({ researchId, userId }).delete();
  }

  /** Exclui uma pesquisa, mas só se nenhum pesquisador a baixou. */
  async delete(id: number, currentUser: UserPayLoad) {
    const research = await this.findOne(id, currentUser);

    // Só dá para excluir enquanto nenhum pesquisador tiver baixado a pesquisa: depois do primeiro download
    // pode haver coletas em campo, e excluir apagaria tudo.
    if ((await countDownloads(this.prisma.client.orm.public, id)) > 0) {
      throw new BadRequestException('Esta pesquisa já foi baixada por pesquisadores e não pode mais ser excluída.');
    }

    const deleted = await this.prisma.client.orm.public.Research.where({ id }).delete();

    // As coletas e respostas saem junto (cascata no banco); as mídias delas (Cloudinary) também.
    // Todas ficam sob `<id da pesquisa>/`. Se a limpeza falhar, a exclusão já valeu: só registra.
    await this.audioStorage
      .removeDir(String(id))
      .catch((error) => this.logger.error(`Pesquisa ${id} excluída, mas as mídias não foram apagadas: ${error?.message ?? error}`));

    return deleted;
  }

  // ---------- cópias em campo (W11) ----------

  /** Monta como uma cópia baixada aparece na API: aparelho, dono, quem revogou e quem desbloqueou. */
  private async copyView(copy: CopyRow, names: Map<number, { name: string; username: string; avatarUrl: string | null }>, deviceBlocked = false) {
    const owner = copy.userId != null ? names.get(copy.userId) : undefined;
    const revoker = copy.revokedById != null ? names.get(copy.revokedById) : undefined;
    const unblocker = copy.unblockedById != null ? names.get(copy.unblockedById) : undefined;
    return {
      id: copy.id,
      researchId: copy.researchId,
      status: copyStatus(copy),
      userId: copy.userId,
      researcherName: owner?.name ?? null,
      researcherUsername: owner?.username ?? null,
      researcherAvatarUrl: owner?.avatarUrl ?? null,
      deviceId: copy.deviceId,
      downloadedAt: copy.createdAt,
      returnedAt: copy.returnedAt ?? null,
      revokedAt: copy.revokedAt ?? null,
      revokedById: copy.revokedById ?? null,
      revokedByName: revoker?.name ?? null,
      revokeReason: copy.revokeReason ?? null,
      unblockedAt: copy.unblockedAt ?? null,
      unblockedByName: unblocker?.name ?? null,
      // O aparelho desta cópia está bloqueado agora (revogado e ainda não desbloqueado): dá para desbloquear.
      deviceBlocked,
    };
  }

  /**
   * Quem está com a pesquisa: contador de cópias ativas, o motivo da trava e o histórico completo
   * (ativas primeiro; devolvidas e revogadas ficam registradas com data).
   */
  /**
   * Mesma informação de `listCopies`, mas em partes limitadas (painel web): as cópias ativas, os
   * usuários
   * revogados (no máximo 100) e o histórico em PÁGINAS, com `?page=&pageSize=&status=&q=`.
   */
  async listCopiesPage(researchId: number, query: CopiesPageQueryDto, currentUser: UserPayLoad) {
    const full = await this.listCopies(researchId, currentUser);
    const { copies, ...lock } = full;
    const LIMIT = 100;

    const active = copies.filter((c) => c.status === 'ACTIVE');
    const history = copies.filter((c) => c.status !== 'ACTIVE');

    // Usuários revogados: quem teve ao menos uma cópia revogada, com o aparelho mais recente de cada um.
    type Copy = (typeof copies)[number];
    const revokedUsers = new Map<
      string,
      { key: string; name: string | null; username: string | null; avatarUrl: string | null; devices: Copy[]; blocked: number; revocations: number }
    >();
    for (const c of copies) {
      if (c.status !== 'REVOKED') continue;
      const key = c.userId != null ? `u${c.userId}` : `d${c.deviceId}`;
      const entry = revokedUsers.get(key) ?? {
        key, name: c.researcherName, username: c.researcherUsername, avatarUrl: c.researcherAvatarUrl, devices: [], blocked: 0, revocations: 0,
      };
      entry.revocations += 1;
      if (!entry.devices.some((d) => d.deviceId === c.deviceId)) {
        entry.devices.push(c);
        if (c.deviceBlocked) entry.blocked += 1;
      }
      revokedUsers.set(key, entry);
    }
    const revokedList = [...revokedUsers.values()].sort(
      (a, b) => b.blocked - a.blocked || (a.name ?? '').localeCompare(b.name ?? ''),
    );

    // O botão de desbloquear aparece só na cópia mais recente de cada aparelho bloqueado.
    const unblockableIds = new Set<number>();
    const seenDevices = new Set<string>();
    for (const c of history) {
      if (c.deviceBlocked && !seenDevices.has(c.deviceId)) {
        seenDevices.add(c.deviceId);
        unblockableIds.add(c.id);
      }
    }

    const term = normalizeText(query.q?.trim());
    const terms = term.split(/\s+/).filter(Boolean);
    const matching = history.filter((c) => {
      if (query.status && query.status !== 'ALL' && c.status !== query.status) return false;
      if (terms.length === 0) return true;
      const haystack = normalizeText(
        [c.researcherName, c.researcherUsername, c.deviceId, c.revokeReason, c.revokedByName, c.unblockedByName]
          .filter(Boolean)
          .join(' '),
      );
      return terms.every((t) => haystack.includes(t));
    });
    const params = pageParams(query);
    const pageItems = matching
      .slice(params.offset, params.offset + params.pageSize)
      .map((c) => ({ ...c, unblockable: unblockableIds.has(c.id) }));

    return {
      ...lock,
      active: active.slice(0, LIMIT),
      activeTotal: active.length,
      revokedUsers: revokedList.slice(0, LIMIT),
      revokedUsersTotal: revokedList.length,
      historyTotal: history.length,
      history: toPage(pageItems, matching.length, params),
    };
  }

  /** Lista o histórico de cópias baixadas da pesquisa. Pesquisador não pode. */
  async listCopies(researchId: number, currentUser: UserPayLoad) {
    if (currentUser.profile === 'RESEARCHER') throw new ForbiddenException('Researchers cannot list copies');

    const research = await this.findOne(researchId, currentUser);
    const orm = this.prisma.client.orm.public;
    const rows = (await orm.ResearchDownload.where({ researchId }).all()) as CopyRow[];

    const names = new Map<number, { name: string; username: string; avatarUrl: string | null }>();
    const ids = new Set<number>();
    for (const row of rows) {
      if (row.userId != null) ids.add(row.userId);
      if (row.revokedById != null) ids.add(row.revokedById);
      if (row.unblockedById != null) ids.add(row.unblockedById);
    }
    for (const id of ids) {
      const u = await orm.User.where({ id }).first();
      if (u) names.set(id, { name: u.name, username: u.username, avatarUrl: u.avatarUrl ?? null });
    }

    const blockedDevices = new Set<string>();
    for (const row of rows) {
      if (row.revokedAt && !row.unblockedAt && !row.active) blockedDevices.add(row.deviceId);
    }
    const copies = await Promise.all(rows.map((row) => this.copyView(row, names, blockedDevices.has(row.deviceId))));
    const rank = { ACTIVE: 0, REVOKED: 1, RETURNED: 1 } as const;
    copies.sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        String(b.revokedAt ?? b.returnedAt ?? b.downloadedAt).localeCompare(String(a.revokedAt ?? a.returnedAt ?? a.downloadedAt)),
    );

    const lock = await getLockState(orm, research);
    return {
      researchId,
      locked: lock.locked,
      lockReason: lock.reason,
      lockMessage: lock.message,
      activeCopies: lock.activeCopies,
      copies,
    };
  }

  /**
   * Devolução: o aparelho informa que não tem mais a pesquisa. Registra a data e o contador cai;
   * na última, a pesquisa volta a ser editável sozinha. Idempotente (devolver de novo não falha).
   */
  async returnOwnCopy(researchId: number, deviceId: string, currentUser: UserPayLoad) {
    if (currentUser.profile !== 'RESEARCHER') throw new ForbiddenException('Only researchers return copies');

    const orm = this.prisma.client.orm.public;
    const research = await orm.Research.where({ id: researchId }).first();
    if (!research || research.companyId !== currentUser.companyId) throw new NotFoundException('Pesquisa não encontrada.');

    const user = await this.currentUserRecord(currentUser);
    if (!user) throw new ForbiddenException('Usuário não encontrado.');

    const { returned, copy } = await returnCopy(orm, { researchId, userId: user.id, deviceId });
    const lock = await getLockState(orm, research);

    return {
      returned,
      returnedAt: copy?.returnedAt ?? null,
      // `revoked`: o administrador já tinha revogado este aparelho; o app deve apagar a pesquisa local.
      revoked: !returned && (await isDeviceRevoked(orm, researchId, deviceId)),
      activeCopies: lock.activeCopies,
      locked: lock.locked,
    };
  }

  /**
   * Revogação forçada (aparelho perdido, quebrado, pesquisador que saiu): a cópia deixa de contar,
   * o contador é liberado e o aparelho perde o acesso à pesquisa (não baixa, não envia coletas
   * novas nem arquivos). Registra quem revogou, quando e por quê.
   */
  async revokeActiveCopy(researchId: number, copyId: number, reason: string | undefined, currentUser: UserPayLoad) {
    if (currentUser.profile === 'RESEARCHER') throw new ForbiddenException('Researchers cannot revoke copies');

    const research = await this.findOne(researchId, currentUser);
    const orm = this.prisma.client.orm.public;

    const copy = (await orm.ResearchDownload.where({ id: copyId, researchId }).first()) as CopyRow | null;
    if (!copy) throw new NotFoundException('Cópia não encontrada nesta pesquisa.');

    if (!copy.active) {
      if (copy.revokedAt) return this.revocationResult(copy, research, orm); // já revogada: nada a refazer
      throw new BadRequestException('Esta cópia já foi devolvida pelo aparelho: não há o que revogar.');
    }

    const admin = await this.currentUserRecord(currentUser);
    if (!admin) throw new ForbiddenException('Usuário não encontrado.');

    const revoked = await revokeCopy(orm, copy, { revokedById: admin.id, reason });
    this.logger.warn(
      `Cópia ${copy.id} da pesquisa ${researchId} (aparelho ${copy.deviceId}) revogada por ${admin.username}` +
      (reason ? `: ${reason}` : ''),
    );
    return this.revocationResult(revoked, research, orm);
  }

  /**
   * Desbloquear aparelho: desfaz a revogação. O histórico da revogação fica (com quem desbloqueou e quando)
   * e o aparelho volta a poder baixar a pesquisa, o que cria uma cópia nova e trava o questionário de novo.
   * Idempotente: desbloquear um aparelho que não está bloqueado não faz nada.
   */
  async unblockCopyDevice(researchId: number, copyId: number, currentUser: UserPayLoad) {
    if (currentUser.profile === 'RESEARCHER') throw new ForbiddenException('Researchers cannot unblock devices');

    const research = await this.findOne(researchId, currentUser);
    const orm = this.prisma.client.orm.public;

    const copy = (await orm.ResearchDownload.where({ id: copyId, researchId }).first()) as CopyRow | null;
    if (!copy) throw new NotFoundException('Cópia não encontrada nesta pesquisa.');
    if (!copy.revokedAt) throw new BadRequestException('Só aparelhos com a cópia revogada podem ser desbloqueados.');

    const admin = await this.currentUserRecord(currentUser);
    if (!admin) throw new ForbiddenException('Usuário não encontrado.');

    const changed = await unblockDevice(orm, researchId, copy.deviceId, { unblockedById: admin.id });
    if (changed > 0) {
      this.logger.warn(`Aparelho ${copy.deviceId} desbloqueado na pesquisa ${researchId} por ${admin.username}`);
    }

    const fresh = (await orm.ResearchDownload.where({ id: copyId }).first()) as CopyRow;
    return this.revocationResult(fresh, research, orm);
  }

  /** Monta a resposta de uma revogação, resolvendo os nomes das pessoas envolvidas. */
  private async revocationResult(copy: CopyRow, research: { id: number; status: string }, orm: any) {
    const names = new Map<number, { name: string; username: string; avatarUrl: string | null }>();
    for (const id of [copy.userId, copy.revokedById, copy.unblockedById]) {
      if (id == null) continue;
      const u = await orm.User.where({ id }).first();
      if (u) names.set(id, { name: u.name, username: u.username, avatarUrl: u.avatarUrl ?? null });
    }
    const lock = await getLockState(orm, research);
    return {
      copy: await this.copyView(copy, names, await isDeviceRevoked(orm, copy.researchId, copy.deviceId)),
      activeCopies: lock.activeCopies,
      locked: lock.locked,
    };
  }

  /** Pacote completo da pesquisa para o app móvel (uma única resposta) */
  async downloadPackage(researchId: number, deviceId: string, currentUser: UserPayLoad) {
    const orm = this.prisma.client.orm.public;

    if (currentUser.profile !== 'RESEARCHER') {
      throw new ForbiddenException('Only researchers linked to this research can download it');
    }

    const research = await orm.Research.where({ id: researchId }).first();

    // Rascunho não é visível para o app; pesquisa de outra empresa também não.
    if (!research || research.status === ResearchStatus.DRAFT || research.companyId !== currentUser.companyId) {
      throw new NotFoundException('Pesquisa não encontrada.');
    }

    // No token, `sub` é o username (não o id numérico)
    const user = await orm.User.where({ username: String(currentUser.sub) }).first();
    if (!user) throw new ForbiddenException('Usuário não encontrado.');

    const link = await orm.ResearchResearcher.where({ researchId, userId: user.id }).first();
    if (!link) throw new ForbiddenException('Você não está vinculado a esta pesquisa.');

    // Aparelho com a cópia revogada pelo administrador não baixa de novo (o acesso dele foi invalidado).
    if (await isDeviceRevoked(orm, research.id, deviceId)) throw copyRevokedException();

    if (research.status === ResearchStatus.CLOSED) {
      throw new ForbiddenException('Pesquisa encerrada: não está disponível para download.');
    }

    const now = new Date();
    const start = new Date(research.startDate);
    const end = new Date(research.endDate);
    // data de término sem horário vale até o fim do dia
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(research.endDate))) end.setUTCHours(23, 59, 59, 999);

    if (now < start || now > end) {
      throw new ForbiddenException('Pesquisa fora da vigência: não está disponível para download.');
    }

    // Seções, questões e opções, sempre na ordem do questionário
    const sections = (await orm.Section.where({ researchId: research.id }).all()).sort((a, b) => a.order - b.order);

    const sectionsWithDetails = await Promise.all(
      sections.map(async (section) => {
        const questions = (await orm.Question.where({ sectionId: section.id }).all()).sort((a, b) => a.order - b.order);

        const questionsWithDetails = await Promise.all(
          questions.map(async (question) => {
            const options = (await orm.QuestionOption.where({ questionId: question.id }).all()).sort((a, b) => a.order - b.order);

            return {
              ...question, // campos planos mantidos por compatibilidade com o app
              options,
              validations: {
                isRequired: question.isRequired,
                minSelections: question.minSelections,
                maxSelections: question.maxSelections,
                minValue: question.minValue,
                maxValue: question.maxValue,
                minDate: question.minDate,
                maxDate: question.maxDate,
                maxLength: question.maxLength,
              },
              recording: {
                maxFiles: question.maxFiles,
                maxDuration: question.maxDuration,
              },
            };
          })
        );

        return { ...section, questions: questionsWithDetails };
      })
    );

    // Regras de pulo/exibição: a questão alvo só aparece quando a questão de origem
    // recebe a resposta triggerValue.
    const rules = await orm.QuestionRule.where({ researchId: research.id }).all();
    // Cada linha é uma CONDIÇÃO. O aplicativo agrupa por alvo + groupKey (E) e combina os grupos (OU).
    // Os campos antigos (sourceQuestionId, triggerValue, targetQuestionId) continuam; os novos têm padrão
    // EQ / SHOW, então um app antigo ainda entende as regras simples.
    const displayRules = rules.map((rule) => ({
      id: rule.id,
      sourceQuestionId: rule.sourceQuestionId,
      operator: rule.operator ?? 'EQ',
      triggerValue: rule.triggerValue,
      targetQuestionId: rule.targetQuestionId ?? null,
      targetSectionId: rule.targetSectionId ?? null,
      action: rule.action ?? 'SHOW',
      groupKey: rule.groupKey ?? null,
    }));

    // Registra a cópia ativa (pesquisador + aparelho + data). O mesmo aparelho baixando de novo renova a
    // própria cópia; o mesmo pesquisador em outro aparelho cria outra cópia (conta duas). Com a primeira
    // cópia a estrutura do questionário trava (W11).
    const copy = await registerCopy(orm, { researchId: research.id, userId: user.id, deviceId });

    // Primeiro download de uma pesquisa publicada: ela passa a estar "em campo".
    // Downloads seguintes (já em campo) não alteram o status.
    let status = research.status;
    if (status === ResearchStatus.PUBLISHED) {
      await orm.Research.where({ id: research.id }).update({ status: ResearchStatus.IN_FIELD });
      status = ResearchStatus.IN_FIELD;
    }

    return {
      ...research,
      status,
      // Interruptor de gravação: o app só inicia a coleta depois do consentimento quando isto é true
      recordInterview: research.recordInterview,
      sections: sectionsWithDetails,
      displayRules,
      download: { id: copy.id, deviceId, downloadedAt: copy.createdAt },
    };
  }
}

import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { runPaged, type SituationPageQueryDto } from '../common/pagination.js';
import { recentActivities } from '../dashboard/dashboard.service.js';
import { AvatarStorage, type CompanyImageKind, type UploadedImage } from '../auth/avatar-storage.js';

/** Regras de empresas: listagens, cadastro, edição, desativação, exclusão e imagens (logo e capa). */
@Injectable()
export class CompanyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly imageStorage: AvatarStorage,
  ) { }

  /** Lista as empresas: o superadministrador vê todas; os demais, só a própria. */
  async findAll(currentUser: UserPayLoad) {
    // Regra 1: Superadmin vê mais de uma empresa (vê todas)
    if (currentUser.profile === 'SUPERADMINISTRATOR') return this.prisma.client.orm.public.Company.all();

    // Regra 2: O administrador (e pesquisador) vive dentro da dele
    if (!currentUser.companyId) throw new ForbiddenException('User has no associated company');

    // Filtra no banco para retornar APENAS a empresa cujo ID seja o do usuário logado
    return this.prisma.client.orm.public.Company.where({ id: currentUser.companyId }).all();
  }

  /**
   * Lista paginada (painel web): `?page=&pageSize=&q=&situation=&sort=`. Só a página sai do
   * servidor.
   */
  async findPage(query: SituationPageQueryDto, currentUser: UserPayLoad) {
    const companies = this.prisma.client.orm.public.Company;

    let scoped;
    if (currentUser.profile === 'SUPERADMINISTRATOR') {
      scoped = companies.where((c) => c.id.gt(0));
    } else {
      if (!currentUser.companyId) throw new ForbiddenException('User has no associated company');
      scoped = companies.where({ id: currentUser.companyId });
    }
    if (query.situation) scoped = scoped.where({ situation: query.situation });

    const sorted =
      query.sort === 'name'
        ? scoped.orderBy([(c) => c.legalName.asc(), (c) => c.id.asc()])
        : scoped.orderBy([(c) => c.createdAt.desc(), (c) => c.id.desc()]);

    type Row = Awaited<ReturnType<typeof sorted.all>>[number];
    return runPaged<Row>(query, {
      count: async () => (await scoped.aggregate((a) => ({ total: a.count() }))).total,
      page: async (limit, offset) => [...(await sorted.limit(limit).offset(offset).all())],
      all: async () => [...(await sorted.all())],
      searchText: (c) => `${c.legalName} ${c.contactInformation}`,
    });
  }

  /** Números da tela de empresas (totais e cadastros por mês do ano), sem enviar as listas. */
  async stats(currentUser: UserPayLoad) {
    if (currentUser.profile !== 'SUPERADMINISTRATOR') throw new ForbiddenException('Only super administrators can see company statistics.');

    const orm = this.prisma.client.orm.public;
    const year = new Date().getFullYear();
    const byMonth = (rows: { createdAt: string }[]) => {
      const months = Array.from({ length: 12 }, () => 0);
      for (const row of rows) {
        const date = new Date(row.createdAt);
        if (date.getFullYear() === year) months[date.getMonth()] += 1;
      }
      return months;
    };

    const companies = [...(await orm.Company.all())];
    const admins = [...(await orm.User.where({ profile: 'ADMINISTRATOR' }).all())];
    const active = companies.filter((c) => c.situation === 'ACTIVE').length;

    // Atividade recente e as empresas mais novas (só as 10 e as 8 mais novas).
    const toDate = (raw: string | null | undefined) => {
      const date = raw ? new Date(raw) : null;
      return date && !Number.isNaN(date.getTime()) ? date : null;
    };
    const items: Parameters<typeof recentActivities>[0] = [];
    for (const company of companies) {
      const created = toDate(company.createdAt);
      const updated = toDate(company.updatedAt);
      if (created) items.push({ id: `company-${company.id}-created`, kind: 'company', message: `Empresa “${company.legalName}” cadastrada`, at: created });
      if (created && updated && updated.getTime() - created.getTime() > 2000) {
        items.push({
          id: `company-${company.id}-updated`,
          kind: 'company',
          message: company.situation === 'INACTIVE' ? `Empresa “${company.legalName}” desativada` : `Empresa “${company.legalName}” atualizada`,
          at: updated,
        });
      }
    }
    for (const admin of admins) {
      const created = toDate(admin.createdAt);
      if (created) items.push({ id: `admin-${admin.id}-created`, kind: 'admin', message: `Administrador “${admin.name}” cadastrado`, at: created });
    }
    const recentCompanies = [...companies]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8)
      .map((c) => ({ id: c.id, legalName: c.legalName, situation: c.situation }));

    return {
      year,
      recentCompanies,
      activities: recentActivities(items),
      companies: companies.length,
      activeCompanies: active,
      inactiveCompanies: companies.length - active,
      admins: admins.length,
      companiesByMonth: byMonth(companies),
      adminsByMonth: byMonth(admins),
    };
  }

  /** Cadastra uma empresa. Só o superadministrador pode. */
  async create(createCompanyDto: CreateCompanyDto, currentUser: UserPayLoad) {
    if (currentUser.profile !== 'SUPERADMINISTRATOR') throw new ForbiddenException('Only super administrators can create companies.');

    return this.prisma.client.orm.public.Company.create({
      legalName: createCompanyDto.legalName,
      contactInformation: createCompanyDto.contactInformation,
      situation: createCompanyDto.situation,
    });
  }

  /** Desativa uma empresa sem apagar os dados. Só o superadministrador pode. */
  async deactivate(id: number, currentUser: UserPayLoad) {
    if (currentUser.profile !== 'SUPERADMINISTRATOR') throw new ForbiddenException('Only super administrators can deactivate companies.');

    return await this.prisma.client.orm.public.Company.where({ id }).update({ situation: 'INACTIVE' });
  }

  /** Busca uma empresa pelo id. Lança 404 se não existir. */
  private async findOne(id: number) {
    const company = await this.prisma.client.orm.public.Company.where({ id }).first();

    if (!company) throw new NotFoundException('Company not found');

    return company;
  }

  /** Edita razão social, contato e/ou situação da empresa. Só o superadministrador pode. */
  async update(id: number, updateCompanyDto: UpdateCompanyDto, currentUser: UserPayLoad) {
    if (currentUser.profile !== 'SUPERADMINISTRATOR') throw new ForbiddenException('Only super administrators can edit companies.');

    await this.findOne(id);

    const data: { legalName?: string; contactInformation?: string; situation?: 'ACTIVE' | 'INACTIVE' } = {};

    if (updateCompanyDto.legalName !== undefined) data.legalName = updateCompanyDto.legalName.trim();
    if (updateCompanyDto.contactInformation !== undefined) data.contactInformation = updateCompanyDto.contactInformation.trim();
    if (updateCompanyDto.situation !== undefined) data.situation = updateCompanyDto.situation as 'ACTIVE' | 'INACTIVE';

    if (Object.keys(data).length > 0) {
      await this.prisma.client.orm.public.Company.where({ id }).update(data);
    }

    return this.findOne(id);
  }

  /**
   * Logo e capa: o administrador da própria empresa (e o superadministrador) personaliza. As
   * imagens ficam no
   * Cloudinary e só o endereço delas fica no banco.
   */
  private assertCanEditImages(id: number, currentUser: UserPayLoad) {
    const isOwnAdmin = currentUser.profile === 'ADMINISTRATOR' && currentUser.companyId === id;

    if (currentUser.profile !== 'SUPERADMINISTRATOR' && !isOwnAdmin) {
      throw new ForbiddenException('Only the company administrator can change its images.');
    }
  }

  /**
   * Troca o logo ou a capa da empresa: valida a imagem, envia ao armazenamento e grava o novo
   * endereço.
   */
  async setImage(id: number, kind: CompanyImageKind, file: UploadedImage | undefined, currentUser: UserPayLoad) {
    this.assertCanEditImages(id, currentUser);
    this.imageStorage.assertValid(file);

    const company = await this.findOne(id);
    const url = await this.imageStorage.saveCompanyImage(id, kind, file!.buffer);

    await this.prisma.client.orm.public.Company.where({ id }).update(kind === 'logo' ? { logoUrl: url } : { coverUrl: url });

    // A imagem nova substitui a antiga no mesmo endereço; se o endereço mudou (pasta do Cloudinary trocada), apaga a antiga.
    const previous = kind === 'logo' ? company.logoUrl : company.coverUrl;
    if (previous && !this.imageStorage.samePicture(previous, url)) await this.imageStorage.remove(previous);

    return this.findOne(id);
  }

  /** Remove o logo ou a capa da empresa, no armazenamento e no banco. */
  async removeImage(id: number, kind: CompanyImageKind, currentUser: UserPayLoad) {
    this.assertCanEditImages(id, currentUser);

    const company = await this.findOne(id);
    const previous = kind === 'logo' ? company.logoUrl : company.coverUrl;

    if (previous) {
      await this.imageStorage.remove(previous);
      await this.prisma.client.orm.public.Company.where({ id }).update(kind === 'logo' ? { logoUrl: null } : { coverUrl: null });
    }

    return this.findOne(id);
  }

  /**
   * Exclui uma empresa. Só o superadministrador pode, e empresas com vínculos devem ser desativadas
   * em vez de excluídas.
   */
  async remove(id: number, currentUser: UserPayLoad) {
    if (currentUser.profile !== 'SUPERADMINISTRATOR') throw new ForbiddenException('Only super administrators can delete companies.');

    const company = await this.findOne(id);

    // Usuários e pesquisas não são apagados em cascata: com vínculos, o caminho é desativar.
    const orm = this.prisma.client.orm.public;
    const hasUsers = await orm.User.where({ companyId: id }).first();
    const hasResearches = await orm.Research.where({ companyId: id }).first();

    if (hasUsers || hasResearches) {
      throw new ConflictException('Company has linked users or researches and cannot be deleted');
    }

    await orm.Company.where({ id }).delete();

    return company;
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import * as bcrypt from 'bcrypt';
import { generateTemporaryPassword } from '../auth/password-policy.js';
import { runPaged, type UserPageQueryDto } from '../common/pagination.js';

@Injectable()
export class UserService {
    constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { }

    async findOne(username: string) {
        const user = await this.prisma.client.orm.public.User.where({ username }).first()

        if (!user) throw new NotFoundException('User not found')

        return user;
    }

    async findAll(currentUser: UserPayLoad) {
        let users;

        if (currentUser.profile === 'SUPERADMINISTRATOR') {
            users = await this.prisma.client.orm.public.User.all();
        } else {
            users = await this.prisma.client.orm.public.User.where({
                companyId: currentUser.companyId,
            }).all();
        }

        return users.map(user => {
            const { passwordHash: _, ...userWithoutPassword } = user;
            return userWithoutPassword;
        })

    }

    // Lista paginada (painel web): `?page=&pageSize=&q=&profile=&situation=&sort=`. Só a página sai do servidor.
    // `admins: true` é a lista de administradores (só o superadministrador a vê).
    async findPage(query: UserPageQueryDto, currentUser: UserPayLoad, admins = false) {
        const users = this.prisma.client.orm.public.User;
        const orm = this.prisma.client.orm.public;

        if (admins && currentUser.profile !== 'SUPERADMINISTRATOR') {
            return { items: [], total: 0, page: 1, pageSize: query.pageSize ?? 20, totalPages: 1 };
        }

        let scoped =
            currentUser.profile === 'SUPERADMINISTRATOR'
                ? users.where((u) => u.id.gt(0))
                : users.where({ companyId: currentUser.companyId });
        if (admins) scoped = scoped.where({ profile: 'ADMINISTRATOR' });
        else if (query.profile) scoped = scoped.where({ profile: query.profile });
        if (query.situation) scoped = scoped.where({ situation: query.situation });

        const sorted =
            query.sort === 'name'
                ? scoped.orderBy([(u) => u.name.asc(), (u) => u.id.asc()])
                : scoped.orderBy([(u) => u.createdAt.desc(), (u) => u.id.desc()]);

        type Row = Awaited<ReturnType<typeof sorted.all>>[number];
        // A busca também acha pelo nome da empresa: só carrega as empresas quando há texto.
        const companyNames = new Map<number, string>();
        if (query.q?.trim()) {
            for (const c of await orm.Company.all()) companyNames.set(c.id, c.legalName);
        }

        const page = await runPaged<Row>(query, {
            count: async () => (await scoped.aggregate((a) => ({ total: a.count() }))).total,
            page: async (limit, offset) => [...(await sorted.limit(limit).offset(offset).all())],
            all: async () => [...(await sorted.all())],
            searchText: (u) => `${u.name} ${u.username} ${u.companyId !== null ? (companyNames.get(u.companyId) ?? '') : ''}`,
        });

        // Nome da empresa só das pessoas desta página, em UMA consulta.
        const companyIds = [...new Set(page.items.map((u) => u.companyId).filter((id): id is number => id !== null))];
        const companyRows = companyIds.length > 0 ? [...(await orm.Company.where((c) => c.id.in(companyIds)).all())] : [];
        const names = new Map<number, string | null>(companyRows.map((c) => [c.id, c.legalName]));

        return {
            ...page,
            items: page.items.map((user) => {
                const { passwordHash: _, ...userWithoutPassword } = user;
                return { ...userWithoutPassword, companyName: user.companyId !== null ? (names.get(user.companyId) ?? null) : null };
            }),
        };
    }

    // Números do painel de pesquisadores (total, ritmo de cadastros, empresas), sem enviar a lista.
    async researcherStats(currentUser: UserPayLoad) {
        const users = this.prisma.client.orm.public.User;
        const scoped =
            currentUser.profile === 'SUPERADMINISTRATOR'
                ? users.where({ profile: 'RESEARCHER' })
                : users.where({ profile: 'RESEARCHER', companyId: currentUser.companyId });

        const DAY = 24 * 60 * 60 * 1000;
        const WEEKS = 8;
        const now = Date.now();
        const weekly = Array.from({ length: WEEKS }, () => 0);
        const companies = new Set<number | null>();
        let total = 0;
        let active = 0;
        let recent = 0;

        for (const user of await scoped.all()) {
            total += 1;
            if (user.situation !== 'INACTIVE') active += 1;
            companies.add(user.companyId);
            const created = new Date(user.createdAt).getTime();
            if (Number.isNaN(created)) continue;
            if (created >= now - 30 * DAY) recent += 1;
            const ago = Math.floor((now - created) / (7 * DAY));
            if (ago >= 0 && ago < WEEKS) weekly[WEEKS - 1 - ago] += 1;
        }

        return { total, active, inactive: total - active, recent, companies: companies.size, weekly, referenceTime: now };
    }

    async findAllAdmin(currentUser: UserPayLoad) {

        if (currentUser.profile === 'SUPERADMINISTRATOR') {
            const users = await this.prisma.client.orm.public.User.where({ profile: 'ADMINISTRATOR' }).all()

            return users.map(user => {
                const { passwordHash: _, ...userWithoutPassword } = user;
                return userWithoutPassword;
            })
        }

    }

    async create(createUserDto: CreateUserDto, currentUser: UserPayLoad) {
        if (currentUser.profile === 'RESEARCHER') {
            throw new ForbiddenException('Researchers cannot register users');
        }

        let companyId = createUserDto.companyId;

        if (currentUser.profile === 'ADMINISTRATOR') {
            if (createUserDto.profile !== 'RESEARCHER') {
                throw new ForbiddenException('Administrators can only register researchers');
            }

            if (!currentUser.companyId) {
                throw new ForbiddenException('User is not associated with a company');
            }

            companyId = currentUser.companyId;
        }

        if (currentUser.profile === 'SUPERADMINISTRATOR' && !companyId) {
            throw new BadRequestException('The company ID is required for super administrators');
        }

        const existingUser = await this.prisma.client.orm.public.User.where({ username: createUserDto.username }).first();

        if (existingUser) throw new ConflictException('Username already exists');

        const passwordHash = await bcrypt.hash(createUserDto.password, 10);

        const newUser = await this.prisma.client.orm.public.User.create({
            name: createUserDto.name,
            username: createUserDto.username,
            passwordHash,
            profile: createUserDto.profile,
            companyId: companyId,
            // A senha foi definida por quem cadastrou: a própria pessoa precisa trocá-la no primeiro acesso.
            mustChangePassword: true,
        });

        const { passwordHash: _, ...userWithoutPassword } = newUser;

        return userWithoutPassword;
    }

    // Quem pode mexer em quem:
    // - superadministrador: administradores e pesquisadores (nunca outro superadministrador);
    // - administrador: somente pesquisadores da própria empresa;
    // - pesquisador: ninguém.
    private assertCanManage(
        target: { profile: string; companyId: number | null },
        currentUser: UserPayLoad,
        action: 'edit' | 'delete' | 'deactivate' | 'reset the password of',
    ) {
        if (currentUser.profile === 'RESEARCHER') {
            throw new ForbiddenException('Researchers cannot manage users');
        }

        if (target.profile === 'SUPERADMINISTRATOR') {
            const verb = action === 'delete' ? 'deleted' : action === 'edit' ? 'edited' : action === 'deactivate' ? 'deactivated' : 'reset by another user';

            throw new ForbiddenException(`Superadministrators cannot be ${verb}`);
        }

        if (currentUser.profile === 'ADMINISTRATOR') {
            const sameCompany = !!currentUser.companyId && target.companyId === currentUser.companyId;

            if (target.profile !== 'RESEARCHER' || !sameCompany) {
                throw new ForbiddenException('Administrators can only manage researchers from their own company');
            }
        }
    }

    async update(username: string, updateUserDto: UpdateUserDto, currentUser: UserPayLoad) {
        const target = await this.findOne(username);

        this.assertCanManage(target, currentUser, 'edit');

        const data: { name?: string; username?: string; passwordHash?: string; mustChangePassword?: boolean } = {};

        if (updateUserDto.name !== undefined) data.name = updateUserDto.name.trim();

        const newUsername = updateUserDto.username?.trim();

        if (newUsername && newUsername !== target.username) {
            const existingUser = await this.prisma.client.orm.public.User.where({ username: newUsername }).first();

            if (existingUser) throw new ConflictException('Username already exists');

            data.username = newUsername;
        }

        if (updateUserDto.password) {
            data.passwordHash = await bcrypt.hash(updateUserDto.password, 10);
            // Senha definida por outra pessoa é temporária; quem troca a própria senha não precisa trocar de novo.
            data.mustChangePassword = target.username !== String(currentUser.sub);
        }

        if (Object.keys(data).length > 0) {
            await this.prisma.client.orm.public.User.where({ username }).update(data);
        }

        const updated = await this.findOne(data.username ?? username);

        const { passwordHash: _, ...userWithoutPassword } = updated;

        return userWithoutPassword;
    }

    // Redefinição de senha feita por quem gerencia a conta (esqueceu a senha, aparelho perdido...). Gera uma senha
    // temporária aleatória, que só aparece nesta resposta, e obriga a troca no próximo acesso. Também destrava a conta
    // e derruba as sessões abertas (o token antigo deixa de valer porque a senha mudou).
    async resetPassword(username: string, currentUser: UserPayLoad) {
        if (username === String(currentUser.sub)) {
            throw new ForbiddenException('Use the profile screen to change your own password');
        }

        const target = await this.findOne(username);

        this.assertCanManage(target, currentUser, 'reset the password of');

        const temporaryPassword = generateTemporaryPassword();

        await this.prisma.client.orm.public.User.where({ username }).update({
            passwordHash: await bcrypt.hash(temporaryPassword, 10),
            mustChangePassword: true,
            failedLoginAttempts: 0,
            lockedUntil: null,
        });

        return { username, temporaryPassword, mustChangePassword: true };
    }

    async setSituation(username: string, situation: 'ACTIVE' | 'INACTIVE', currentUser: UserPayLoad) {
        if (username === String(currentUser.sub)) {
            throw new ForbiddenException('You cannot deactivate your own account');
        }

        const target = await this.findOne(username);

        this.assertCanManage(target, currentUser, 'deactivate');

        await this.prisma.client.orm.public.User.where({ username }).update({ situation });

        const updated = await this.findOne(username);

        const { passwordHash: _, ...userWithoutPassword } = updated;

        return userWithoutPassword;
    }

    // Libera ou bloqueia o aplicativo para TODOS os pesquisadores da empresa do administrador de uma vez.
    // Usa a mesma situação de cada pesquisador: quem fica INACTIVE não entra no app e perde a sessão na hora
    // (ver AuthService/AuthGuard). O administrador e os dados das coletas não são tocados.
    async setResearchersSituation(situation: 'ACTIVE' | 'INACTIVE', currentUser: UserPayLoad) {
        if (currentUser.profile !== 'ADMINISTRATOR' || !currentUser.companyId) {
            throw new ForbiddenException('Only company administrators can change access for all researchers');
        }

        const users = this.prisma.client.orm.public.User;
        const researchers = await users.where({ companyId: currentUser.companyId, profile: 'RESEARCHER' }).all();

        for (const researcher of researchers) {
            if (researcher.situation !== situation) {
                await users.where({ username: researcher.username }).update({ situation });
            }
        }

        return { total: researchers.length, active: situation === 'ACTIVE' ? researchers.length : 0, inactive: situation === 'INACTIVE' ? researchers.length : 0 };
    }

    async delete(username: string, currentUser: UserPayLoad) {
        // No token, "sub" guarda o username de quem está logado.
        if (username === String(currentUser.sub)) {
            throw new ForbiddenException('You cannot delete your own account');
        }

        const user = await this.findOne(username);

        this.assertCanManage(user, currentUser, 'delete');

        // Coletas e envios já registrados não têm exclusão em cascata: apagar o pesquisador
        // quebraria o histórico (e o banco recusaria). Melhor avisar do que dar erro genérico.
        const orm = this.prisma.client.orm.public;
        const hasCollections = await orm.Collection.where({ researcherId: user.id }).first();
        const hasSyncLogs = await orm.SyncLog.where({ researcherId: user.id }).first();

        if (hasCollections || hasSyncLogs) {
            throw new ConflictException('User has collected data and cannot be deleted');
        }

        await orm.User.where({ username }).delete();

        const { passwordHash: _, ...userWithoutPassword } = user;

        return userWithoutPassword;
    }
}

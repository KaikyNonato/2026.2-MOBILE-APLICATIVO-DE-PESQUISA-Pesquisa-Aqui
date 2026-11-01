import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UserService } from '../user/user.service.js';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma.service.js';
import { AvatarStorage, type UploadedImage } from './avatar-storage.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { buildTokenPayload } from './token-payload.js';

// Bloqueio temporário contra tentativa de senha: ao errar MAX_ATTEMPTS vezes seguidas, a conta fica trancada por LOCK_MINUTES.
const envInt = (name: string, fallback: number) => {
    const value = Number.parseInt(process.env[name] ?? '', 10);

    return Number.isFinite(value) && value > 0 ? value : fallback;
};
const maxLoginAttempts = () => envInt('LOGIN_MAX_ATTEMPTS', 5);
const lockMinutes = () => envInt('LOGIN_LOCK_MINUTES', 15);

@Injectable()
export class AuthService {
    constructor(
        private userService: UserService,
        private jwtService: JwtService,
        private prisma: PrismaService,
        private avatarStorage: AvatarStorage,
    ) { }

    async login(loginDto: LoginDto): Promise<{ access_token: string; mustChangePassword: boolean }> {
        const user = await this.userService.findOne(loginDto.username).catch((error) => {
            if (error instanceof NotFoundException) return null;
            throw error;
        });

        // Conta trancada: nem confere a senha (quem acerta durante o bloqueio também não entra).
        if (user?.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
            this.throwLocked(user.lockedUntil);
        }

        if (!user || (!await bcrypt.compare(loginDto.password, user.passwordHash))) {
            if (user) await this.registerFailedLogin(user);

            throw new UnauthorizedException('Invalid user or password');
        }

        if (user.failedLoginAttempts > 0 || user.lockedUntil) {
            await this.prisma.client.orm.public.User.where({ username: user.username }).update({ failedLoginAttempts: 0, lockedUntil: null });
        }

        if (loginDto.platform === 'mobile' && user.profile !== 'RESEARCHER') {
            throw new ForbiddenException('Acesso negado: Aplicativo exclusivo para pesquisadores.');
        }

        if (user.situation === 'INACTIVE') {
            throw new UnauthorizedException('Access denied: Inactive user');
        }

        if (user.companyId) {
            const company = await this.prisma.client.orm.public.Company.where({ id: user.companyId }).first();

            if (company && company.situation === 'INACTIVE') {
                throw new UnauthorizedException('Access denied: Inactive company')
            }
        }

        return {
            access_token: await this.jwtService.signAsync(buildTokenPayload(user)),
            mustChangePassword: user.mustChangePassword === true,
        }
    }

    private async registerFailedLogin(user: { username: string; failedLoginAttempts: number }) {
        const attempts = (user.failedLoginAttempts ?? 0) + 1;
        const lock = attempts >= maxLoginAttempts();
        const lockedUntil = lock ? new Date(Date.now() + lockMinutes() * 60_000).toISOString() : null;

        await this.prisma.client.orm.public.User.where({ username: user.username }).update({
            // Ao trancar, zera o contador: depois do bloqueio a pessoa ganha novas tentativas.
            failedLoginAttempts: lock ? 0 : attempts,
            lockedUntil,
        });

        if (lock) this.throwLocked(lockedUntil!);
    }

    private throwLocked(lockedUntil: string): never {
        const seconds = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 1000));

        throw new HttpException(
            {
                statusCode: HttpStatus.TOO_MANY_REQUESTS,
                code: 'ACCOUNT_LOCKED',
                message: `Muitas tentativas de login. Tente novamente em ${Math.ceil(seconds / 60)} minuto(s).`,
                retryAfterSeconds: seconds,
            },
            HttpStatus.TOO_MANY_REQUESTS,
        );
    }

    async getMe(payload: any) {
        // A foto não vai no token (ela muda sem o usuário entrar de novo): vem do banco a cada chamada.
        const user = await this.prisma.client.orm.public.User.where({ username: String(payload.sub) }).first();
        const avatarUrl = user?.avatarUrl ?? null;
        const mustChangePassword = user?.mustChangePassword === true;

        if (!payload.companyId) return { ...payload, avatarUrl, mustChangePassword };

        const company = await this.prisma.client.orm.public.Company.where({ id: payload.companyId }).first();

        return {
            ...payload,
            avatarUrl,
            mustChangePassword,
            companyName: company?.legalName ?? null,
            companyLogoUrl: company?.logoUrl ?? null,
        };
    }

    // Dados atuais do usuário logado (direto do banco, sem a senha) e o nome da empresa.
    async getProfile(payload: any) {
        const user = await this.userService.findOne(String(payload.sub));

        return this.toProfile(user);
    }

    // O próprio usuário altera nome, usuário e senha. Quem manda no pesquisador é o administrador da empresa,
    // então pesquisador não edita o próprio cadastro por aqui.
    // Devolve também um token novo: o token carrega nome e usuário, que podem ter mudado.
    async updateProfile(payload: any, dto: UpdateProfileDto) {
        if (payload.profile === 'RESEARCHER') {
            throw new ForbiddenException('Researchers cannot edit their own profile');
        }

        const user = await this.userService.findOne(String(payload.sub));
        const users = this.prisma.client.orm.public.User;
        const data: { name?: string; username?: string; passwordHash?: string; mustChangePassword?: boolean } = {};

        const name = dto.name?.trim();

        if (name && name !== user.name) data.name = name;

        const username = dto.username?.trim();

        if (username && username !== user.username) {
            const existingUser = await users.where({ username }).first();

            if (existingUser) throw new ConflictException('Username already exists');

            data.username = username;
        }

        if (dto.newPassword) {
            // 400 (e não 401): o painel desloga a pessoa em qualquer 401.
            if (!dto.currentPassword) throw new BadRequestException('Current password is required');

            if (!await bcrypt.compare(dto.currentPassword, user.passwordHash)) {
                throw new BadRequestException('Current password is incorrect');
            }

            data.passwordHash = await bcrypt.hash(dto.newPassword, 10);
            data.mustChangePassword = false;
        }

        if (Object.keys(data).length > 0) {
            await users.where({ username: user.username }).update(data);
        }

        const updated = await this.userService.findOne(data.username ?? user.username);

        const access_token = await this.jwtService.signAsync(buildTokenPayload(updated));

        return { profile: await this.toProfile(updated), access_token };
    }

    // Troca de senha de qualquer perfil (inclusive pesquisador). É a rota usada para sair da senha temporária.
    // A senha nova invalida todos os tokens antigos; devolvemos um novo para a sessão atual continuar.
    async changePassword(payload: any, dto: ChangePasswordDto) {
        const user = await this.userService.findOne(String(payload.sub));

        // 400 (e não 401): o painel desloga a pessoa em qualquer 401.
        if (!await bcrypt.compare(dto.currentPassword, user.passwordHash)) {
            throw new BadRequestException('Current password is incorrect');
        }

        if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
            throw new BadRequestException('The new password must be different from the current one');
        }

        await this.prisma.client.orm.public.User.where({ username: user.username }).update({
            passwordHash: await bcrypt.hash(dto.newPassword, 10),
            mustChangePassword: false,
        });

        const updated = await this.userService.findOne(user.username);

        return { access_token: await this.jwtService.signAsync(buildTokenPayload(updated)), message: 'Password changed' };
    }

    // Foto de perfil: qualquer usuário logado (inclusive pesquisador) troca a própria. A imagem vai para o Cloudinary
    // e só o endereço dela fica no banco.
    async setAvatar(payload: any, file: UploadedImage | undefined) {
        this.avatarStorage.assertValid(file);

        const user = await this.userService.findOne(String(payload.sub));
        const avatarUrl = await this.avatarStorage.save(user.id, file!.buffer);

        await this.prisma.client.orm.public.User.where({ username: user.username }).update({ avatarUrl });

        // A foto nova substitui a antiga no mesmo endereço; se o endereço mudou (pasta do Cloudinary trocada), apaga a antiga.
        if (user.avatarUrl && !this.avatarStorage.samePicture(user.avatarUrl, avatarUrl)) {
            await this.avatarStorage.remove(user.avatarUrl);
        }

        return this.toProfile(await this.userService.findOne(user.username));
    }

    async removeAvatar(payload: any) {
        const user = await this.userService.findOne(String(payload.sub));

        if (user.avatarUrl) {
            await this.avatarStorage.remove(user.avatarUrl);
            await this.prisma.client.orm.public.User.where({ username: user.username }).update({ avatarUrl: null });
        }

        return this.toProfile(await this.userService.findOne(user.username));
    }

    private async toProfile(user: Awaited<ReturnType<UserService['findOne']>>) {
        const { passwordHash: _, ...userWithoutPassword } = user;

        let companyName: string | null = null;
        let companyLogoUrl: string | null = null;

        if (user.companyId) {
            const company = await this.prisma.client.orm.public.Company.where({ id: user.companyId }).first();

            companyName = company?.legalName ?? null;
            companyLogoUrl = company?.logoUrl ?? null;
        }

        return { ...userWithoutPassword, companyName, companyLogoUrl };
    }
}

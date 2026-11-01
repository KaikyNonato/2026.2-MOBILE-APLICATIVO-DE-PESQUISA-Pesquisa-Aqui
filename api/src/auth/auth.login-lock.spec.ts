// O cliente do banco é ESM puro e não é necessário aqui: os testes entregam um banco de mentira.
jest.mock('../prisma.service.js', () => ({ PrismaService: class {} }));

import { NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service.js';

type Row = Record<string, any>;

function setup(row: Row | null) {
    const updates: Row[] = [];
    const prisma: any = {
        client: {
            orm: {
                public: {
                    User: { where: () => ({ update: async (data: Row) => { updates.push(data); Object.assign(row!, data); } }) },
                    Company: { where: () => ({ first: async () => null }) },
                },
            },
        },
    };
    const userService: any = { findOne: async () => { if (!row) throw new NotFoundException(); return row; } };
    const jwt: any = { signAsync: async (payload: Row) => `token:${JSON.stringify(payload)}` };
    const service = new AuthService(userService, jwt, prisma, {} as any);

    return { service, updates };
}

const baseUser = async (extra: Row = {}): Promise<Row> => ({
    username: 'ana', name: 'Ana', profile: 'RESEARCHER', companyId: 1, situation: 'ACTIVE',
    passwordHash: await bcrypt.hash('senha1234', 4), failedLoginAttempts: 0, lockedUntil: null, mustChangePassword: false,
    ...extra,
});

describe('AuthService.login - bloqueio por tentativas', () => {
    beforeEach(() => { process.env.LOGIN_MAX_ATTEMPTS = '3'; process.env.LOGIN_LOCK_MINUTES = '10'; });
    afterEach(() => { delete process.env.LOGIN_MAX_ATTEMPTS; delete process.env.LOGIN_LOCK_MINUTES; });

    it('conta falhas e tranca na última tentativa permitida', async () => {
        const user = await baseUser();
        const { service } = setup(user);
        const bad = { username: 'ana', password: 'errada123' };

        await expect(service.login(bad)).rejects.toMatchObject({ status: 401 });
        await expect(service.login(bad)).rejects.toMatchObject({ status: 401 });
        expect(user.failedLoginAttempts).toBe(2);

        await expect(service.login(bad)).rejects.toMatchObject({ status: 429 });
        expect(user.lockedUntil).not.toBeNull();
    });

    it('conta trancada recusa até a senha certa', async () => {
        const user = await baseUser({ lockedUntil: new Date(Date.now() + 5 * 60_000).toISOString() });
        const { service } = setup(user);

        await expect(service.login({ username: 'ana', password: 'senha1234' })).rejects.toMatchObject({ status: 429 });
    });

    it('depois do bloqueio expirar, a senha certa entra e zera o contador', async () => {
        const user = await baseUser({ failedLoginAttempts: 2, lockedUntil: new Date(Date.now() - 1000).toISOString() });
        const { service } = setup(user);

        const result = await service.login({ username: 'ana', password: 'senha1234' });

        expect(result.access_token).toContain('"pv"');
        expect(user.failedLoginAttempts).toBe(0);
        expect(user.lockedUntil).toBeNull();
    });

    it('usuário que não existe recebe o mesmo 401, sem contar nada', async () => {
        const { service, updates } = setup(null);

        await expect(service.login({ username: 'ninguem', password: 'x' })).rejects.toMatchObject({ status: 401 });
        expect(updates).toHaveLength(0);
    });

    it('avisa quando a senha é temporária', async () => {
        const { service } = setup(await baseUser({ mustChangePassword: true }));

        expect((await service.login({ username: 'ana', password: 'senha1234' })).mustChangePassword).toBe(true);
    });
});

describe('AuthService.changePassword', () => {
    it('troca a senha, tira a marca de temporária e gera token novo', async () => {
        const user = await baseUser({ mustChangePassword: true });
        const { service } = setup(user);
        const before = user.passwordHash;

        const result = await service.changePassword({ sub: 'ana' }, { currentPassword: 'senha1234', newPassword: 'outra5678' });

        expect(user.mustChangePassword).toBe(false);
        expect(user.passwordHash).not.toBe(before);
        expect(await bcrypt.compare('outra5678', user.passwordHash)).toBe(true);
        expect(result.access_token).toContain('"pv"');
    });

    it('recusa senha atual errada e senha repetida', async () => {
        const { service } = setup(await baseUser());

        await expect(service.changePassword({ sub: 'ana' }, { currentPassword: 'x', newPassword: 'outra5678' })).rejects.toMatchObject({ status: 400 });
        await expect(service.changePassword({ sub: 'ana' }, { currentPassword: 'senha1234', newPassword: 'senha1234' })).rejects.toMatchObject({ status: 400 });
    });
});

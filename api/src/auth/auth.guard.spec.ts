// O cliente do banco é ESM puro e não é necessário aqui: os testes entregam um banco de mentira.
jest.mock('../prisma.service.js', () => ({ PrismaService: class {} }));

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { passwordVersion } from './token-payload.js';

const user = (extra: Record<string, any> = {}) => ({ username: 'ana', situation: 'ACTIVE', passwordHash: 'hash-1', mustChangePassword: false, ...extra });

function run(payload: any, row: any, allowed = false) {
    const prisma: any = { client: { orm: { public: {
        User: { where: () => ({ first: async () => row }) },
        Company: { where: () => ({ first: async () => null }) },
    } } } };
    const jwt: any = { verifyAsync: async () => payload };
    const reflector = { getAllAndOverride: () => allowed } as unknown as Reflector;
    const guard = new AuthGuard(jwt, prisma, reflector);
    const request: any = { headers: { authorization: 'Bearer t' }, cookies: {} };
    const context: any = { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => null, getClass: () => null };

    return guard.canActivate(context);
}

const goodPayload = { sub: 'ana', pv: passwordVersion('hash-1') };

describe('AuthGuard', () => {
    it('aceita token válido', async () => {
        await expect(run(goodPayload, user())).resolves.toBe(true);
    });

    it('recusa usuário excluído', async () => {
        await expect(run(goodPayload, null)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('recusa usuário desativado', async () => {
        await expect(run(goodPayload, user({ situation: 'INACTIVE' }))).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('recusa token emitido antes da troca de senha ou sem versão de senha', async () => {
        await expect(run({ sub: 'ana', pv: passwordVersion('hash-antigo') }, user())).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(run({ sub: 'ana' }, user())).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('senha temporária: bloqueia rotas comuns e libera as marcadas', async () => {
        await expect(run(goodPayload, user({ mustChangePassword: true }))).rejects.toBeInstanceOf(ForbiddenException);
        await expect(run(goodPayload, user({ mustChangePassword: true }), true)).resolves.toBe(true);
    });
});

import { createHash } from 'node:crypto';

// Impressão digital da senha atual, guardada no token (`pv`). Quando a senha muda, o valor muda e todos os tokens
// antigos deixam de valer na hora (o AuthGuard compara). Não revela a senha nem o hash.
export function passwordVersion(passwordHash: string): string {
    return createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
}

type TokenUser = { username: string; name: string; profile: string; companyId: number | null; passwordHash: string };

export function buildTokenPayload(user: TokenUser) {
    return {
        sub: user.username,
        name: user.name,
        profile: user.profile,
        companyId: user.companyId,
        pv: passwordVersion(user.passwordHash),
    };
}

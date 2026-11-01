import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_KEY = 'allowWhenPasswordChangeRequired';

// Rotas que continuam abertas para quem ainda precisa trocar a senha temporária (ver, trocar a senha e sair).
export const AllowWhenPasswordChangeRequired = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);

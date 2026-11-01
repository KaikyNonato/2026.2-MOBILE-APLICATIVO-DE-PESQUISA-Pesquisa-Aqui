import { applyDecorators } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_MIN_LENGTH = 8;
// O bcrypt só considera os primeiros 72 bytes da senha; um limite menor evita senhas "cortadas" sem aviso.
export const PASSWORD_MAX_LENGTH = 64;

export const PASSWORD_RULES_MESSAGE = `A senha deve ter de ${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caracteres, com pelo menos uma letra e um número.`;

/** Devolve a mensagem do que está errado na senha, ou `null` se ela é aceita. */
export function passwordProblem(password: string): string | null {
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return PASSWORD_RULES_MESSAGE;
    if (!/\p{L}/u.test(password) || !/\d/.test(password)) return PASSWORD_RULES_MESSAGE;
    return null;
}

/** Regra única de senha para todos os DTOs: tamanho, ao menos uma letra e ao menos um número. */
export function StrongPassword() {
    return applyDecorators(
        IsString(),
        MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULES_MESSAGE }),
        MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_RULES_MESSAGE }),
        Matches(/\p{L}/u, { message: PASSWORD_RULES_MESSAGE }),
        Matches(/\d/, { message: PASSWORD_RULES_MESSAGE }),
    );
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';

/** Senha temporária aleatória (sem caracteres ambíguos como 0/O e 1/l), sempre com letras e números. */
export function generateTemporaryPassword(length = 12): string {
    const chars = [ALPHABET[randomInt(ALPHABET.length)], DIGITS[randomInt(DIGITS.length)]];
    const all = ALPHABET + DIGITS;

    while (chars.length < length) chars.push(all[randomInt(all.length)]);

    for (let i = chars.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
}

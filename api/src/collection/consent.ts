import { BadRequestException } from '@nestjs/common';

export const CONSENT_REQUIRED = 'CONSENT_REQUIRED';

export type ConsentInput = { accepted?: boolean; acceptedAt?: string } | null | undefined;

/**
 * Pesquisa que grava a entrevista só aceita coleta com o consentimento do entrevistado registrado:
 * aceite explícito, com data e hora, anterior ao início da coleta.
 * Devolve o instante do aceite já validado.
 */
export function assertValidConsent(consent: ConsentInput, startedAt: string): Date {
  const refuse = (message: string) =>
    new BadRequestException({ statusCode: 400, code: CONSENT_REQUIRED, message });

  if (!consent || consent.accepted !== true) {
    throw refuse('Esta pesquisa grava a entrevista: a coleta só é aceita com o consentimento do entrevistado registrado.');
  }

  const acceptedAt = new Date(consent.acceptedAt ?? '');
  if (Number.isNaN(acceptedAt.getTime())) {
    throw refuse('O consentimento precisa informar a data e a hora do aceite.');
  }

  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime()) || acceptedAt.getTime() > started.getTime()) {
    throw refuse('O consentimento precisa ser registrado antes do início da coleta.');
  }

  return acceptedAt;
}

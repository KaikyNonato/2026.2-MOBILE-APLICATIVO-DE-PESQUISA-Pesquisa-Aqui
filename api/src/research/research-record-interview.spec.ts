import { ForbiddenException } from '@nestjs/common';
import { ResearchService } from './research.service';

/**
 * W11: a trava vem das cópias ativas (pesquisa baixada em algum aparelho), não do status.
 * Só a estrutura do questionário trava; a gravação da entrevista é estrutura, o resto dos dados da
 * pesquisa não.
 */
function setup(status: string, recordInterview: boolean, downloads: any[] = []) {
  const research = { id: 1, companyId: 10, status, recordInterview };
  const update = jest.fn(async (data: any) => ({ ...research, ...data }));
  const prisma = {
    client: {
      orm: {
        public: {
          Research: { where: () => ({ first: async () => research, update }) },
          Section: { where: () => ({ all: async () => [{ id: 7 }] }) },
          Question: { where: () => ({ first: async () => ({ id: 1 }) }) },
          // só as cópias ativas contam para a trava
          ResearchDownload: { where: (f: any) => ({ all: async () => downloads.filter((d) => f.active === undefined || d.active === f.active) }) },
        },
      },
    },
  } as any;
  const user = { sub: 'adm', username: 'adm', profile: 'ADMINISTRATOR', companyId: 10 } as any;
  return { service: new ResearchService(prisma, { removeDir: jest.fn() } as any), update, user };
}

const activeCopy = { id: 3, researchId: 1, deviceId: 'a1', userId: 2, active: true };
const returnedCopy = { id: 4, researchId: 1, deviceId: 'a2', userId: 3, active: false, returnedAt: '2026-10-10T10:00:00.000Z' };

describe('ResearchService.update — travamento da estrutura', () => {
  it('edita livremente no rascunho (inclusive a gravação da entrevista)', async () => {
    const { service, update, user } = setup('DRAFT', false);
    await service.update(1, { recordInterview: true, description: 'nova' }, user);
    expect(update).toHaveBeenCalledWith({ recordInterview: true, description: 'nova' });
  });

  it.each(['PUBLISHED', 'IN_FIELD'])('pesquisa %s SEM cópia ativa continua editável', async (status) => {
    const { service, update, user } = setup(status, false);
    await service.update(1, { recordInterview: true }, user);
    expect(update).toHaveBeenCalledWith({ recordInterview: true });
  });

  it('com cópia ativa, a gravação da entrevista não liga nem desliga', async () => {
    const { service, update, user } = setup('IN_FIELD', false, [activeCopy]);
    await expect(service.update(1, { recordInterview: true }, user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('com cópia ativa, dados que não são estrutura (prazo, título, descrição) seguem liberados', async () => {
    const { service, update, user } = setup('IN_FIELD', false, [activeCopy]);
    await service.update(1, { endDate: '2999-12-31', title: 'novo', description: 'nova' }, user);
    expect(update).toHaveBeenCalledWith({ endDate: '2999-12-31', title: 'novo', description: 'nova' });
  });

  it('repetir o valor atual da gravação não é mudança', async () => {
    const { service, update, user } = setup('IN_FIELD', true, [activeCopy]);
    await service.update(1, { recordInterview: true, title: 'x' }, user);
    expect(update).toHaveBeenCalled();
  });

  it('cópia devolvida não trava', async () => {
    const { service, update, user } = setup('IN_FIELD', false, [returnedCopy]);
    await service.update(1, { recordInterview: true }, user);
    expect(update).toHaveBeenCalledWith({ recordInterview: true });
  });

  it('continua permitindo avançar o status de uma pesquisa publicada, mesmo com cópia ativa', async () => {
    const { service, update, user } = setup('PUBLISHED', false, [activeCopy]);
    await service.update(1, { status: 'IN_FIELD' as any }, user);
    expect(update).toHaveBeenCalledWith({ status: 'IN_FIELD' });
  });
});

describe('ResearchService.assertEditable', () => {
  it('libera rascunho sem cópias', async () => {
    const { service, user } = setup('DRAFT', false);
    await expect(service.assertEditable(1, user)).resolves.toMatchObject({ id: 1 });
  });

  it.each(['PUBLISHED', 'IN_FIELD'])('libera pesquisa %s sem cópia ativa', async (status) => {
    const { service, user } = setup(status, false);
    await expect(service.assertEditable(1, user)).resolves.toMatchObject({ id: 1 });
  });

  it('bloqueia com cópia ativa', async () => {
    const { service, user } = setup('IN_FIELD', false, [activeCopy]);
    await expect(service.assertEditable(1, user)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('não bloqueia só porque já houve download (devolvido)', async () => {
    const { service, user } = setup('IN_FIELD', false, [returnedCopy]);
    await expect(service.assertEditable(1, user)).resolves.toMatchObject({ id: 1 });
  });

  it('pesquisa encerrada não tem a estrutura editada', async () => {
    const { service, user } = setup('CLOSED', false);
    await expect(service.assertEditable(1, user)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

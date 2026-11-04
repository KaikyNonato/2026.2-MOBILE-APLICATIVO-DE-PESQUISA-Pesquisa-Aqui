import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import type { UserPayLoad } from '../auth/current-user.type.js';

export type MediaImage = { buffer: Buffer; contentType: string };
export type CompanyImageKind = 'logo' | 'cover';

const MIN_SIZE = 16;
const MAX_SIZE = 1600;

/** Tamanho pedido na URL (`?w=96`): número inteiro entre 16 e 1600; qualquer outra coisa é ignorada. */
const sizeOf = (raw: string | undefined): number | null => {
  const value = Number(raw);
  return Number.isInteger(value) && value >= MIN_SIZE && value <= MAX_SIZE ? value : null;
};

/**
 * Entrega as imagens guardadas no Cloudinary (foto de perfil, logo e capa da empresa) pela própria
 * API, para o endereço
 * do Cloudinary não aparecer para quem usa o painel ou o aplicativo. Só entrega para quem está
 * logado e, fora o
 * superadministrador, só imagens da própria empresa.
 */
@Injectable()
export class MediaService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { }

  /**
   * Garante que o usuário pode ver a imagem: o superadministrador vê todas; os demais, só as da
   * própria empresa.
   */
  private assertCanSee(viewer: UserPayLoad, ownerCompanyId: number | null) {
    if (viewer.profile === 'SUPERADMINISTRATOR') return;
    if (ownerCompanyId === null || viewer.companyId !== ownerCompanyId) {
      throw new ForbiddenException('You cannot see this image');
    }
  }

  /** Busca a foto de perfil de um usuário, no tamanho pedido (se válido), conferindo a permissão. */
  async avatar(userId: number, viewer: UserPayLoad, width: string | undefined, accept: string | undefined): Promise<MediaImage> {
    const user = await this.prisma.client.orm.public.User.where({ id: userId }).first();

    if (!user?.avatarUrl) throw new NotFoundException('Image not found');
    this.assertCanSee(viewer, user.companyId ?? null);

    const w = sizeOf(width);
    return this.fetchImage(user.avatarUrl, w ? `c_fill,g_face,w_${w},h_${w},f_auto,q_auto` : null, accept);
  }

  /** Busca o logo ou a capa de uma empresa, no tamanho pedido (se válido), conferindo a permissão. */
  async companyImage(
    companyId: number,
    kind: CompanyImageKind,
    viewer: UserPayLoad,
    width: string | undefined,
    height: string | undefined,
    accept: string | undefined,
  ): Promise<MediaImage> {
    const company = await this.prisma.client.orm.public.Company.where({ id: companyId }).first();
    const stored = kind === 'logo' ? company?.logoUrl : company?.coverUrl;

    if (!stored) throw new NotFoundException('Image not found');
    this.assertCanSee(viewer, companyId);

    const w = sizeOf(width);
    const h = sizeOf(height) ?? (w ? Math.max(MIN_SIZE, Math.round(w * 0.3)) : null);

    const transformation = !w
      ? null
      : kind === 'logo'
        ? `c_fit,w_${w},h_${sizeOf(height) ?? w},f_auto,q_auto`
        : `c_fill,w_${w},h_${h},f_auto,q_auto`;

    return this.fetchImage(stored, transformation, accept);
  }

  /**
   * Busca a imagem no Cloudinary (só aceita endereços https do próprio Cloudinary) já no tamanho
   * pedido.
   */
  private async fetchImage(storedUrl: string, transformation: string | null, accept: string | undefined): Promise<MediaImage> {
    let url: URL;
    try {
      url = new URL(storedUrl);
    } catch {
      throw new NotFoundException('Image not found');
    }
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') throw new NotFoundException('Image not found');

    let target = storedUrl;
    if (transformation) {
      const marker = '/image/upload/';
      const at = storedUrl.indexOf(marker);
      if (at === -1) throw new NotFoundException('Image not found');
      target = `${storedUrl.slice(0, at + marker.length)}${transformation}/${storedUrl.slice(at + marker.length)}`;
    }

    const upstream = await fetch(target, { headers: { Accept: accept || 'image/*' } });
    if (!upstream.ok) throw new NotFoundException('Image not found');

    return {
      buffer: Buffer.from(await upstream.arrayBuffer()),
      contentType: upstream.headers.get('content-type') ?? 'image/jpeg',
    };
  }
}

import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';

// Foto de perfil: até 5 MB, JPG, PNG ou WebP. O tipo declarado não basta: o começo do arquivo também é conferido.
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type CompanyImageKind = 'logo' | 'cover';

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** Confere se o arquivo começa com os bytes informados (a partir de `offset`). */
const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  buffer.length >= offset + bytes.length && bytes.every((byte, i) => buffer[offset + i] === byte);

/**
 * Confere pelos primeiros bytes se o arquivo é mesmo JPEG, PNG ou WebP (o tipo declarado pelo
 * cliente não basta).
 */
const looksLikeAvatar = (buffer: Buffer) =>
  startsWith(buffer, [0xff, 0xd8, 0xff]) || // jpeg
  startsWith(buffer, [0x89, 0x50, 0x4e, 0x47]) || // png
  (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)); // webp

/** `https://res.cloudinary.com/<nuvem>/image/upload/v123/<pasta>/user-7.jpg` -> `<pasta>/user-7` */
const publicIdOf = (url: string): string | null => {
  const match = /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
};

/**
 * Guarda no Cloudinary as fotos de perfil e as imagens das empresas (logo e capa) (mesma
 * configuração das mídias das coletas: CLOUDINARY_URL, ou
 * CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET; CLOUDINARY_FOLDER é a pasta
 * raiz, opcional).
 *
 * Ao contrário das mídias das coletas (privadas), a foto de perfil é uma imagem pública: o painel a
 * mostra direto
 * do Cloudinary, sem passar pela API. Cada usuário tem um único arquivo
 * (`<pasta>/avatars/user-<id>`): enviar outra
 * foto substitui a anterior. O endereço salvo no banco inclui a versão, então a foto nova aparece
 * na hora.
 */
@Injectable()
export class AvatarStorage {
  private readonly logger = new Logger(AvatarStorage.name);
  private ready: boolean | null = null;

  private get configured(): boolean {
    if (this.ready !== null) return this.ready;
    const { CLOUDINARY_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
    if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
      cloudinary.config({
        cloud_name: CLOUDINARY_CLOUD_NAME,
        api_key: CLOUDINARY_API_KEY,
        api_secret: CLOUDINARY_API_SECRET,
        secure: true,
      });
      this.ready = true;
    } else if (CLOUDINARY_URL) {
      cloudinary.config({ secure: true }); // o SDK lê a CLOUDINARY_URL sozinho
      this.ready = true;
    } else {
      this.ready = false;
    }
    return this.ready;
  }

  /** Pasta no Cloudinary: `<CLOUDINARY_FOLDER>/<sub>` (ou só `<sub>`), sem barras nas pontas. */
  private folderFor(sub: 'avatars' | 'companies'): string {
    const root = (process.env.CLOUDINARY_FOLDER ?? '')
      .replace(/\\/g, '/')
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part !== '' && part !== '.' && part !== '..');
    return [...root, sub].join('/');
  }

  /**
   * Valida a imagem enviada (se existe, tipo, tamanho e se o armazenamento está configurado). Lança
   * erro HTTP se algo estiver errado.
   */
  assertValid(file: UploadedImage | undefined): void {
    if (!file) throw new BadRequestException('Envie uma imagem.');
    if (!ALLOWED_TYPES.has(file.mimetype.toLowerCase()) || !looksLikeAvatar(file.buffer)) {
      throw new BadRequestException('Use uma imagem JPG, PNG ou WebP.');
    }
    if (file.size > AVATAR_MAX_BYTES || file.buffer.length > AVATAR_MAX_BYTES) {
      throw new BadRequestException('A foto deve ter no máximo 5 MB.');
    }
    if (!this.configured) {
      throw new ServiceUnavailableException('Armazenamento de imagens não configurado.');
    }
  }

  /**
   * Envia (ou substitui) a foto do usuário e devolve o endereço https dela. A imagem é recortada em
   * quadrado 512x512
   * (centrada no rosto, quando há um) antes de ser guardada.
   */
  async save(userId: number, buffer: Buffer): Promise<string> {
    const folder = this.folderFor('avatars');

    return this.upload(`${folder}/user-${userId}`, folder, buffer, [
      { width: 512, height: 512, crop: 'fill', gravity: 'face' },
      { quality: 'auto' },
    ]);
  }

  /**
   * Imagens da empresa. O logo mantém as proporções (cabe em 512x512, sem cortar); a capa é um
   * banner 1600x480
   * recortado no assunto principal da imagem.
   */
  async saveCompanyImage(companyId: number, kind: CompanyImageKind, buffer: Buffer): Promise<string> {
    const folder = this.folderFor('companies');

    return this.upload(
      `${folder}/company-${companyId}-${kind}`,
      folder,
      buffer,
      kind === 'logo'
        ? [{ width: 512, height: 512, crop: 'limit' }, { quality: 'auto' }]
        : [{ width: 1600, height: 480, crop: 'fill', gravity: 'auto' }, { quality: 'auto' }],
    );
  }

  /**
   * Envia a imagem ao Cloudinary, substituindo a que tiver o mesmo `publicId`, e devolve o endereço
   * https dela.
   */
  private async upload(publicId: string, folder: string, buffer: Buffer, transformation: object[]): Promise<string> {
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          // Modo de pastas dinâmicas do Cloudinary: a pasta mostrada no painel vem daqui, não do public_id.
          asset_folder: folder,
          resource_type: 'image',
          type: 'upload',
          overwrite: true,
          invalidate: true,
          unique_filename: false,
          use_filename: false,
          transformation,
        },
        (error, uploaded) => {
          if (error || !uploaded) reject(new Error(`Falha ao enviar a foto ao Cloudinary: ${error?.message ?? 'sem resposta'}`));
          else resolve(uploaded);
        },
      );
      stream.end(buffer);
    });

    return result.secure_url;
  }

  /** Os dois endereços são da mesma imagem (só a versão muda)? */
  samePicture(a: string, b: string): boolean {
    const first = publicIdOf(a);
    return !!first && first === publicIdOf(b);
  }

  /**
   * Apaga a foto no Cloudinary. Falha aqui não impede o usuário de trocar ou remover a foto: só é
   * registrada.
   */
  async remove(url: string): Promise<void> {
    const publicId = publicIdOf(url);
    if (!publicId || !this.configured) return;

    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image', type: 'upload', invalidate: true });
    } catch (error) {
      this.logger.warn(`Não foi possível apagar a foto ${publicId}: ${error instanceof Error ? error.message : error}`);
    }
  }
}

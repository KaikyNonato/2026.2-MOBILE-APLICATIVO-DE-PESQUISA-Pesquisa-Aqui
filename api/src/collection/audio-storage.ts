import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

// Tipos de áudio aceitos e a extensão com que são guardados. A extensão vem do tipo declarado,
// nunca do nome do arquivo enviado.
const EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/3gpp': '3gp',
};

/** Extensão com que o áudio é guardado, a partir do tipo declarado (`null` se o tipo não é aceito). */
export function audioExtensionFor(mimeType: string): string | null {
  return EXTENSIONS[mimeType.toLowerCase().split(';')[0].trim()] ?? null;
}

// Fotos aceitas nas respostas e a extensão com que são guardadas (também derivada do tipo declarado).
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/** Extensão com que a foto é guardada, a partir do tipo declarado (`null` se o tipo não é aceito). */
export function imageExtensionFor(mimeType: string): string | null {
  return IMAGE_EXTENSIONS[mimeType.toLowerCase().split(';')[0].trim()] ?? null;
}

// Tipo de conteúdo de um arquivo de resposta já guardado, a partir da extensão gravada por este módulo.
const MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  wav: 'audio/wav',
  '3gp': 'audio/3gpp',
  // O Cloudinary informa o formato que ele detectou, que nem sempre é o enviado
  // (um .m4a costuma voltar como `mp4`). Sem estas entradas o arquivo era recusado como "não encontrado".
  mp4: 'audio/mp4',
  weba: 'audio/webm',
  opus: 'audio/ogg',
  oga: 'audio/ogg',
  amr: 'audio/amr',
  flac: 'audio/flac',
  aiff: 'audio/aiff',
  caf: 'audio/x-caf',
};

/** Tipo de conteúdo de um arquivo guardado, pela extensão. O que não for foto é tratado como áudio. */
export function mediaTypeFor(fileName: string): string | null {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (!extension) return null;
  // Foto tem extensão conhecida; qualquer outra coisa guardada pelo servidor é áudio de resposta.
  return MEDIA_TYPES[extension] ?? 'audio/mp4';
}

export interface StoredFile {
  stream: Readable;
  size: number;
}

// Tipo de recurso no Cloudinary: fotos são `image`; áudio é tratado pelo Cloudinary como `video`.
type CloudinaryKind = 'image' | 'video';
const IMAGE_FILE_EXTENSIONS = new Set(Object.values(IMAGE_EXTENSIONS));
const KINDS: CloudinaryKind[] = ['image', 'video'];

/**
 * Guarda o áudio das entrevistas e os arquivos das respostas (fotos e áudios de questão).
 *
 * Com o Cloudinary configurado (CLOUDINARY_URL, ou CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY +
 * CLOUDINARY_API_SECRET) tudo vai para ele, como arquivo PRIVADO (`type: authenticated`): não
 * existe
 * link público, e a API continua sendo o único caminho até o arquivo (endpoint autenticado da
 * coleta).
 * Sem configuração, cai para o disco local (AUDIO_STORAGE_DIR) — pensado só para desenvolvimento.
 *
 * Os caminhos relativos (`<pesquisa>/<uuid>.m4a`, `<pesquisa>/answers/<coleta>/q1-0.jpg`) são os
 * mesmos
 * nos dois modos (e são os que ficam no banco): no Cloudinary o caminho sem a extensão é o
 * `public_id`.
 *
 * CLOUDINARY_FOLDER (opcional) define a pasta raiz no Cloudinary. Cada pesquisa ganha a sua própria
 * subpasta dentro dela: `<CLOUDINARY_FOLDER>/<pesquisa>/...`. Sem a variável, tudo fica como antes
 * (`<pesquisa>/...`).
 * Arquivos antigos, gravados sem a pasta raiz, continuam sendo lidos e apagados normalmente.
 */
@Injectable()
export class AudioStorage {
  private readonly logger = new Logger(AudioStorage.name);
  private cloudinaryReady: boolean | null = null;

  private get useCloudinary(): boolean {
    if (this.cloudinaryReady !== null) return this.cloudinaryReady;
    const { CLOUDINARY_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
    if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
      cloudinary.config({
        cloud_name: CLOUDINARY_CLOUD_NAME,
        api_key: CLOUDINARY_API_KEY,
        api_secret: CLOUDINARY_API_SECRET,
        secure: true,
      });
      this.cloudinaryReady = true;
    } else if (CLOUDINARY_URL) {
      cloudinary.config({ secure: true }); // o SDK lê a CLOUDINARY_URL sozinho
      this.cloudinaryReady = true;
    } else {
      this.cloudinaryReady = false;
      this.logger.warn('Cloudinary não configurado: mídias sendo gravadas em disco local (use só em desenvolvimento).');
    }
    return this.cloudinaryReady;
  }

  // Pasta raiz no Cloudinary (CLOUDINARY_FOLDER), sem barras nas pontas. Vazia = sem pasta raiz.
  private get cloudFolder(): string {
    return (process.env.CLOUDINARY_FOLDER ?? '')
      .replace(/\\/g, '/')
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part !== '' && part !== '.' && part !== '..')
      .join('/');
  }

  // Raízes onde um arquivo pode estar: a atual (onde se grava) e, se houver pasta configurada, a antiga (sem pasta).
  private get cloudRoots(): string[] {
    const folder = this.cloudFolder;
    return folder ? [folder, ''] : [''];
  }

  /** Guarda o áudio da entrevista em `<pesquisa>/<uuid>.<extensão>` e devolve o caminho relativo. */
  async save(researchId: number, buffer: Buffer, extension: string): Promise<string> {
    const relativePath = `${researchId}/${randomUUID()}.${extension}`;
    await this.saveAt(relativePath, buffer);
    return relativePath;
  }

  /**
   * Arquivo de uma resposta: `<pesquisa>/answers/<coleta>/<arquivo>`. O nome é montado pelo
   * servidor.
   */
  async saveAt(relativePath: string, buffer: Buffer): Promise<void> {
    if (this.useCloudinary) return this.cloudSave(relativePath, buffer);
    const target = this.resolveSafe(relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer, { flag: 'wx' });
  }

  /** Nomes dos arquivos de uma pasta (vazio se ela não existe). */
  async list(relativeDir: string): Promise<string[]> {
    if (this.useCloudinary) return this.cloudList(relativeDir);
    try {
      return await readdir(this.resolveSafe(relativeDir));
    } catch {
      return [];
    }
  }

  /** Apaga uma pasta inteira de arquivos. */
  async removeDir(relativeDir: string): Promise<void> {
    if (this.useCloudinary) return this.cloudRemoveDir(relativeDir);
    await rm(this.resolveSafe(relativeDir), { recursive: true, force: true });
  }

  /** Abre um arquivo guardado para leitura (`null` se não existir). */
  async open(relativePath: string): Promise<StoredFile | null> {
    if (this.useCloudinary) return this.cloudOpen(relativePath);
    const target = this.resolveSafe(relativePath);
    try {
      const info = await stat(target);
      return { stream: createReadStream(target), size: info.size };
    } catch {
      return null;
    }
  }

  /** Apaga um arquivo guardado. */
  async remove(relativePath: string): Promise<void> {
    if (this.useCloudinary) return this.cloudRemove(relativePath);
    await rm(this.resolveSafe(relativePath), { force: true });
  }

  // ---------- Cloudinary ----------

  /**
   * `12/answers/3/q5-0.jpg` -> public_id `12/answers/3/q5-0`, formato `jpg`, recurso `image`.
   * Com `root` (ex.: `pesquisas`), o public_id vira `pesquisas/12/answers/3/q5-0`.
   */
  private cloudRef(
    relativePath: string,
    root: string = this.cloudRoots[0],
  ): { publicId: string; format: string; kind: CloudinaryKind } {
    const clean = relativePath.replace(/\\/g, '/');
    if (clean.split('/').some((part) => part === '..' || part === '')) throw new Error('Invalid media path');
    const dot = clean.lastIndexOf('.');
    if (dot <= clean.lastIndexOf('/') + 1) throw new Error('Invalid media path');
    const format = clean.slice(dot + 1).toLowerCase();
    const withoutExtension = clean.slice(0, dot);
    return {
      publicId: root ? `${root}/${withoutExtension}` : withoutExtension,
      format,
      kind: IMAGE_FILE_EXTENSIONS.has(format) ? 'image' : 'video',
    };
  }

  /** Envia o arquivo ao Cloudinary, em pedaços, como mídia privada. */
  private cloudSave(relativePath: string, buffer: Buffer): Promise<void> {
    const { publicId, kind } = this.cloudRef(relativePath);
    return new Promise<void>((resolvePromise, reject) => {
      const uploader = cloudinary.uploader.upload_chunked_stream(
        {
          public_id: publicId,
          // Modo de pastas dinâmicas do Cloudinary: a pasta mostrada no painel vem daqui, não do public_id.
          asset_folder: publicId.slice(0, publicId.lastIndexOf('/')),
          resource_type: kind,
          type: 'authenticated',
          overwrite: false,
          unique_filename: false,
          use_filename: false,
          chunk_size: 20 * 1024 * 1024,
        },
        (error, result) => {
          if (error || !result) reject(new Error(`Falha ao enviar para o Cloudinary: ${error?.message ?? 'sem resposta'}`));
          else resolvePromise();
        },
      );
      uploader.end(buffer);
    });
  }

  /** Link assinado (só a API o gera): o arquivo é `authenticated` e não abre sem a assinatura. */
  private signedUrl(ref: { publicId: string; kind: CloudinaryKind }, format: string): string {
    return cloudinary.url(ref.publicId, {
      resource_type: ref.kind,
      type: 'authenticated',
      format,
      sign_url: true,
      secure: true,
    });
  }

  /** Formato com que o Cloudinary guardou o arquivo (pode diferir da extensão enviada: .m4a -> mp4). */
  private async cloudStoredFormat(ref: { publicId: string; kind: CloudinaryKind }): Promise<string | null> {
    try {
      const info = (await cloudinary.api.resource(ref.publicId, {
        resource_type: ref.kind,
        type: 'authenticated',
      })) as { format?: string };
      return info.format?.toLowerCase() ?? null;
    } catch {
      return null;
    }
  }

  /** Abre um arquivo do Cloudinary, tentando cada pasta raiz conhecida. */
  private async cloudOpen(relativePath: string): Promise<StoredFile | null> {
    for (const root of this.cloudRoots) {
      let ref;
      try {
        ref = this.cloudRef(relativePath, root);
      } catch {
        return null;
      }
      const file = await this.cloudOpenRef(ref);
      if (file) return file;
    }
    return null;
  }

  /**
   * Baixa o arquivo do Cloudinary por endereço assinado. Se o formato pedido estiver errado,
   * consulta o formato real e tenta de novo.
   */
  private async cloudOpenRef(ref: { publicId: string; format: string; kind: CloudinaryKind }): Promise<StoredFile | null> {
    let response = await fetch(this.signedUrl(ref, ref.format));

    // Áudio pedido com a extensão errada (ex.: .m4a, mas o Cloudinary guardou como mp4) não é entregue
    // como original: consulta o formato real e tenta de novo com ele.
    if (!response.ok && ref.kind === 'video') {
      const stored = await this.cloudStoredFormat(ref);
      if (stored && stored !== ref.format) {
        response = await fetch(this.signedUrl(ref, stored));
      }
    }

    if (response.status === 404) return null;
    if (!response.ok || !response.body) throw new Error(`Cloudinary respondeu ${response.status} ao ler o arquivo.`);

    const length = Number(response.headers.get('content-length'));
    if (length > 0 && !response.headers.get('content-encoding')) {
      return { stream: Readable.fromWeb(response.body as never), size: length };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return { stream: Readable.from(buffer), size: buffer.length };
  }

  /** Prefixos de public_id de uma pasta lógica, um por raiz possível. */
  private cloudPrefixes(relativeDir: string): string[] {
    const dir = relativeDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return this.cloudRoots.map((root) => `${[root, dir].filter(Boolean).join('/')}/`);
  }

  /** Lista os nomes dos arquivos de uma pasta no Cloudinary. */
  private async cloudList(relativeDir: string): Promise<string[]> {
    const names = new Set<string>();
    for (const prefix of this.cloudPrefixes(relativeDir)) {
      for (const name of await this.cloudListPrefix(prefix)) names.add(name);
    }
    return [...names];
  }

  /** Lista, página por página, os arquivos que começam com um prefixo, em todos os tipos de mídia. */
  private async cloudListPrefix(prefix: string): Promise<string[]> {
    const names: string[] = [];
    for (const kind of KINDS) {
      let cursor: string | undefined;
      do {
        const page = await cloudinary.api.resources({
          resource_type: kind,
          type: 'authenticated',
          prefix,
          max_results: 500,
          next_cursor: cursor,
        });
        for (const item of page.resources as Array<{ public_id: string; format?: string }>) {
          const base = item.public_id.slice(prefix.length);
          // só arquivos diretamente nesta pasta
          // Áudio sem formato informado: assume m4a (o `open` descobre o formato real se precisar).
          const format = item.format ?? (kind === 'video' ? 'm4a' : undefined);
          if (format && base && !base.includes('/')) names.push(`${base}.${format.toLowerCase()}`);
        }
        cursor = page.next_cursor;
      } while (cursor);
    }
    return names;
  }

  /** Apaga um arquivo do Cloudinary. */
  private async cloudRemove(relativePath: string): Promise<void> {
    for (const root of this.cloudRoots) {
      const { publicId, kind } = this.cloudRef(relativePath, root);
      await cloudinary.uploader.destroy(publicId, { resource_type: kind, type: 'authenticated', invalidate: true });
    }
  }

  /** Apaga todos os arquivos de uma pasta do Cloudinary. */
  private async cloudRemoveDir(relativeDir: string): Promise<void> {
    for (const prefix of this.cloudPrefixes(relativeDir)) await this.cloudRemovePrefix(prefix);
  }

  /**
   * Apaga em lotes os arquivos com um prefixo, repetindo enquanto o Cloudinary indicar que sobrou
   * algo.
   */
  private async cloudRemovePrefix(prefix: string): Promise<void> {
    for (const kind of KINDS) {
      // O Cloudinary apaga em lotes: repete enquanto ele disser que sobrou arquivo (`partial`).
      for (let round = 0; round < 50; round++) {
        const result = await cloudinary.api.delete_resources_by_prefix(prefix, {
          resource_type: kind,
          type: 'authenticated',
          invalidate: true,
        });
        if (!result?.partial) break;
      }
    }
  }

  // Garante que o caminho guardado no banco nunca escapa da pasta de áudios (modo disco).
  private get root(): string {
    return resolve(process.env.AUDIO_STORAGE_DIR || join(process.cwd(), 'storage', 'audio'));
  }

  /**
   * Converte o caminho relativo em absoluto, recusando qualquer um que saia da pasta de
   * armazenamento.
   */
  private resolveSafe(relativePath: string): string {
    const target = resolve(this.root, relativePath);
    if (!target.startsWith(this.root + sep)) throw new Error('Invalid audio path');
    return target;
  }
}

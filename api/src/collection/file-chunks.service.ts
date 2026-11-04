import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { CollectionService, fileRejection } from './collection.service.js';
import type { FileProgressQueryDto, UploadFileChunkDto } from './dto/upload-file-chunk.dto.js';
import { formatLimit, uploadMaxBytes } from './media-validation.js';
import { PartialUploadStore, partialKey } from './partial-upload.store.js';

/** Maior pedaço aceito por requisição (o app manda pedaços bem menores). */
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Envio de arquivo em pedaços, para a rede ruim não obrigar a recomeçar:
 *  - GET  /collection/:clientId/files/progress  -> quantos bytes do arquivo o servidor já tem
 *  - POST /collection/:clientId/files/chunk     -> um pedaço, que começa em `offset`
 * Quando o último pedaço chega, o arquivo inteiro passa pelas MESMAS validações do envio inteiro
 * (CollectionService.uploadFile): questão, tipo, tamanho, conteúdo, "já existe". Nada é gravado por
 * outro caminho.
 */
@Injectable()
export class CollectionFileChunkService {
  constructor(
    private prisma: PrismaService,
    private collectionService: CollectionService,
    private store: PartialUploadStore,
  ) { }

  /**
   * Só o pesquisador dono da coleta, na empresa da pesquisa, manda pedaços; a coleta tem de já ter
   * chegado.
   */
  private async locate(clientId: string, currentUser: UserPayLoad) {
    if (currentUser.profile !== 'RESEARCHER') {
      throw new ForbiddenException('Somente pesquisadores enviam arquivos de coleta.');
    }
    const orm = this.prisma.client.orm.public;
    const user = await orm.User.where({ username: String(currentUser.sub) }).first();
    if (!user) throw new ForbiddenException('Usuário não encontrado.');

    const collection = await orm.Collection.where({ researcherId: user.id, clientId: clientId.toLowerCase() }).first();
    const research = collection ? await orm.Research.where({ id: collection.researchId }).first() : null;
    if (!collection || !research || research.companyId !== currentUser.companyId) {
      throw fileRejection(
        NotFoundException,
        'COLLECTION_NOT_RECEIVED',
        'Esta coleta ainda não chegou ao servidor. Envie a coleta antes dos arquivos.',
        true,
      );
    }
    return collection;
  }

  /** Chave que identifica um arquivo em envio parcial (coleta, questão, tamanho e nome). */
  private keyOf(collectionId: number, questionId: number | undefined, totalBytes: number, name: string) {
    return partialKey(collectionId, questionId ?? null, totalBytes, name.trim());
  }

  /**
   * Informa quantos bytes do arquivo o servidor já recebeu, para o aplicativo retomar de onde
   * parou.
   */
  async progress(clientId: string, query: FileProgressQueryDto, currentUser: UserPayLoad) {
    const collection = await this.locate(clientId, currentUser);
    const key = this.keyOf(collection.id, query.questionId, query.totalBytes, query.name);
    return { receivedBytes: Math.min(await this.store.size(key), query.totalBytes), totalBytes: query.totalBytes };
  }

  /** Recebe um pedaço de arquivo de um envio retomável. */
  async receive(
    clientId: string,
    dto: UploadFileChunkDto,
    chunk: { buffer: Buffer; size: number } | undefined,
    currentUser: UserPayLoad,
  ) {
    if (!chunk) throw fileRejection(BadRequestException, 'FILE_MISSING', 'Nenhum pedaço foi enviado (campo "file").', false);
    if (chunk.buffer.length === 0) throw fileRejection(BadRequestException, 'EMPTY_FILE', 'O pedaço do arquivo está vazio.', false);

    const collection = await this.locate(clientId, currentUser);

    if (dto.totalBytes > uploadMaxBytes()) {
      throw fileRejection(
        BadRequestException,
        'FILE_TOO_LARGE',
        `O arquivo passa do tamanho máximo permitido (${formatLimit(uploadMaxBytes())}).`,
        false,
      );
    }
    if (dto.offset + chunk.buffer.length > dto.totalBytes) {
      throw fileRejection(BadRequestException, 'CHUNK_OUT_OF_RANGE', 'O pedaço passa do tamanho total informado do arquivo.', false);
    }

    const key = this.keyOf(collection.id, dto.questionId, dto.totalBytes, dto.name);
    const received = await this.store.append(key, dto.offset, chunk.buffer);

    // Pedaço fora da posição (repetido ou adiantado): nada foi gravado, o app continua de onde o servidor diz.
    // Faltam bytes: devolve até onde chegou.
    if (received < dto.totalBytes) return { status: 'PARTIAL' as const, receivedBytes: received, totalBytes: dto.totalBytes };

    // Arquivo completo: segue para as validações e para o armazenamento definitivo.
    const buffer = await this.store.read(key);
    try {
      const result = await this.collectionService.uploadFile(
        clientId,
        dto,
        { originalname: dto.name, mimetype: dto.mimeType, size: buffer.length, buffer },
        currentUser,
      );
      await this.store.remove(key);
      return result;
    } catch (error) {
      // Recusa (4xx): reenviar os mesmos bytes não muda nada, então não guarda. Falha do servidor (5xx)
      // mantém o arquivo recebido: a próxima tentativa só refaz a validação e a gravação.
      if (error instanceof HttpException && error.getStatus() < 500) await this.store.remove(key).catch(() => undefined);
      throw error;
    }
  }
}

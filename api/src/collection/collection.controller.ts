import {
    Body,
    Controller,
    Get,
    Header,
    HttpCode,
    Param,
    ParseIntPipe,
    ParseUUIDPipe,
    Post,
    Query,
    StreamableFile,
    UploadedFile,
    UploadedFiles,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { CollectionSyncService } from './collection-sync.service.js';
import { CollectionFileChunkService, MAX_CHUNK_BYTES } from './file-chunks.service.js';
import { CollectionService } from './collection.service.js';
import type { UploadedAudio } from './collection.service.js';
import { CreateCollectionDto, MAX_MEDIA_FILES } from './dto/create-collection.dto.js';
import { SyncCollectionsDto } from './dto/sync-collections.dto.js';
import { UploadCollectionFileDto } from './dto/upload-collection-file.dto.js';
import { FileProgressQueryDto, UploadFileChunkDto } from './dto/upload-file-chunk.dto.js';
import { uploadMaxBytes } from './media-validation.js';
import { CollectionPageQueryDto, isPaged } from '../common/pagination.js';

// Limite do arquivo de áudio por coleta (padrão 150 MB; ajustável por AUDIO_MAX_BYTES).
const MAX_AUDIO_BYTES = Number(process.env.AUDIO_MAX_BYTES) || 150 * 1024 * 1024;

@UseGuards(AuthGuard)
// Sincronização em lote e envio de arquivos em pedaços geram muitas requisições legítimas de vários aparelhos
// no mesmo Wi-Fi (mesmo IP): ficam fora do limite geral. O acesso já exige login.
@SkipThrottle()
@Controller('collection')
export class CollectionController {
    constructor(
        private collectionService: CollectionService,
        private collectionSyncService: CollectionSyncService,
        private fileChunkService: CollectionFileChunkService,
    ) { }

    // multipart/form-data: campo `payload` (JSON com respostas e consentimento) + arquivos opcionais:
    // `audio` (entrevista), `photos` (questões de foto) e `questionAudios` (questões de áudio).
    @Post()
    @UseInterceptors(
        FileFieldsInterceptor(
            [
                { name: 'audio', maxCount: 1 },
                { name: 'photos', maxCount: MAX_MEDIA_FILES },
                { name: 'questionAudios', maxCount: MAX_MEDIA_FILES },
            ],
            { limits: { fileSize: MAX_AUDIO_BYTES, files: 1 + 2 * MAX_MEDIA_FILES } },
        ),
    )
    create(
        @Body() dto: CreateCollectionDto,
        @UploadedFiles() files: { audio?: UploadedAudio[]; photos?: UploadedAudio[]; questionAudios?: UploadedAudio[] } | undefined,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        return this.collectionService.create(dto.payload, files?.audio?.[0], currentUser, {
            photos: files?.photos ?? [],
            questionAudios: files?.questionAudios ?? [],
        });
    }

    // Sincronização offline: recebe um lote de coletas e responde, coleta por coleta, se foi aceita,
    // se já existia (mesmo UUID) ou por que foi recusada. Uma recusa nunca derruba o lote inteiro.
    @Post('sync')
    @HttpCode(200)
    sync(@Body() dto: SyncCollectionsDto, @CurrentUser() currentUser: UserPayLoad) {
        return this.collectionSyncService.sync(dto, currentUser);
    }

    // Envio de arquivo, separado das respostas: a coleta chega primeiro (POST /collection/sync) e cada foto ou
    // áudio sobe depois, ligado a ela pelo UUID da coleta e pela questão (campo `questionId`; sem ele, é o
    // áudio da entrevista). multipart/form-data: `file` + `name` (nome no aparelho) + `questionId`.
    // Reenviar o mesmo arquivo não grava outra cópia (responde ALREADY_EXISTS).
    @Post(':clientId/files')
    @HttpCode(200)
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: uploadMaxBytes(), files: 1 } }))
    uploadFile(
        @Param('clientId', new ParseUUIDPipe()) clientId: string,
        @Body() dto: UploadCollectionFileDto,
        @UploadedFile() file: UploadedAudio | undefined,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        return this.collectionService.uploadFile(clientId, dto, file, currentUser);
    }

    // Envio em pedaços, para arquivo grande em rede ruim: o app pergunta quanto o servidor já tem e continua dali.
    // Quando o último pedaço chega, o arquivo passa pelas mesmas validações do envio inteiro (acima).
    @Get(':clientId/files/progress')
    @Header('Cache-Control', 'private, no-store')
    fileProgress(
        @Param('clientId', new ParseUUIDPipe()) clientId: string,
        @Query() query: FileProgressQueryDto,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        return this.fileChunkService.progress(clientId, query, currentUser);
    }

    // multipart/form-data: `file` (o pedaço) + name, questionId, durationSeconds, mimeType, offset, totalBytes.
    // Responde PARTIAL com `receivedBytes` até o último pedaço; no último, o mesmo resultado do envio inteiro.
    @Post(':clientId/files/chunk')
    @HttpCode(200)
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_CHUNK_BYTES, files: 1 } }))
    uploadFileChunk(
        @Param('clientId', new ParseUUIDPipe()) clientId: string,
        @Body() dto: UploadFileChunkDto,
        @UploadedFile() file: UploadedAudio | undefined,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        return this.fileChunkService.receive(clientId, dto, file, currentUser);
    }

    @Get()
    // Painel web: `?page=&pageSize=&q=&audio=&sort=` devolve só uma página. Sem `page`/`pageSize`, lista inteira.
    findAll(
        @Query('researchId', ParseIntPipe) researchId: number,
        @Query() query: CollectionPageQueryDto,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        if (isPaged(query)) return this.collectionService.findPage(researchId, query, currentUser);
        return this.collectionService.findAll(researchId, currentUser);
    }

    // Totais da pesquisa, sem listar as coletas (precisa vir antes de ":id").
    @Get('stats')
    stats(@Query('researchId', ParseIntPipe) researchId: number, @CurrentUser() currentUser: UserPayLoad) {
        return this.collectionService.stats(researchId, currentUser);
    }

    // Uma coleta com todas as respostas (somente administrador da empresa da pesquisa).
    @Get(':id')
    @Header('Cache-Control', 'private, no-store')
    findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad) {
        return this.collectionService.findOne(id, currentUser);
    }

    // Foto ou áudio de uma resposta, pelo nome devolvido em `files` na coleta aberta.
    @Get(':id/media/:name')
    @Header('Cache-Control', 'private, no-store')
    @Header('X-Content-Type-Options', 'nosniff')
    async media(
        @Param('id', ParseIntPipe) id: number,
        @Param('name') name: string,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        const { stream, size, mimeType } = await this.collectionService.getMedia(id, name, currentUser);
        return new StreamableFile(stream, { type: mimeType, length: size, disposition: 'inline' });
    }

    @Get(':id/audio')
    @Header('Cache-Control', 'private, no-store')
    @Header('X-Content-Type-Options', 'nosniff')
    async audio(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad) {
        const { stream, size, mimeType } = await this.collectionService.getAudio(id, currentUser);
        return new StreamableFile(stream, { type: mimeType, length: size, disposition: 'inline' });
    }
}

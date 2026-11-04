import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module.js';
import { CollectionSyncService } from './collection-sync.service.js';
import { CollectionController } from './collection.controller.js';
import { CollectionFileChunkService } from './file-chunks.service.js';
import { CollectionService } from './collection.service.js';
import { PartialUploadStore } from './partial-upload.store.js';
import { StorageModule } from './storage.module.js';

/** Módulo de coletas: recebimento, sincronização, arquivos e listagens. */
@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [CollectionController],
  providers: [CollectionService, CollectionSyncService, CollectionFileChunkService, PartialUploadStore],
  exports: [CollectionService],
})
export class CollectionModule { }

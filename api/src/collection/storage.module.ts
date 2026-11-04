import { Module } from '@nestjs/common';
import { AudioStorage } from './audio-storage.js';

/** Armazenamento das mídias (Cloudinary). Importe este módulo onde precisar apagar ou ler arquivos. */
@Module({
  providers: [AudioStorage],
  exports: [AudioStorage],
})
export class StorageModule { }

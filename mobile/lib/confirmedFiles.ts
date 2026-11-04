import { File } from 'expo-file-system';
import { answerAudioUriOf, deleteCollectionAudios, getFreeSpaceBytes } from './audioStorage';
import { deleteCollectionPhotos, getStorageUsage, photoUriOf, type StorageUsage } from './photoStorage';

// Arquivos que o servidor já confirmou e ainda ocupam o aparelho.
//
// O envio apaga cada arquivo assim que o servidor o recebe (collectionSender), então normalmente não sobra
// nada. Sobra quando o app foi fechado entre "servidor recebeu" e "apagar", ou quando o sistema não deixou
// apagar. Estes arquivos são seguros de apagar: a fila já os marcou como enviados e nunca mais os lê.
// O que NÃO é confirmado nunca passa por aqui.

export interface ConfirmableCollection {
    clientId: string;
    audio?: { uri: string };
    // Só existe em coleta finalizada: chaves dos arquivos que o servidor já recebeu
    upload?: { uploaded: string[] };
}

export interface ConfirmedFile {
    uri: string;
    bytes: number;
    kind: 'photo' | 'audio';
}

/** Aceita só nomes de arquivo simples (sem `/`, `\\` nem `..`). */
const safeName = (name: string) => name.length > 0 && !name.includes('/') && !name.includes('\\') && name !== '..';

/** Tamanho do arquivo em bytes, ou `null` se não existir. */
function sizeIfExists(uri: string): number | null {
    try {
        const file = new File(uri);
        return file.exists ? file.size : null;
    } catch {
        return null;
    }
}

/**
 * As chaves vêm de listUploadFiles: `interview`, `photo:<questão>:<nome>` e
 * `audio:<questão>:<nome>`.
 */
function uriOfKey(collection: ConfirmableCollection, key: string): { uri: string; kind: 'photo' | 'audio' } | null {
    if (key === 'interview') return collection.audio?.uri ? { uri: collection.audio.uri, kind: 'audio' } : null;

    const match = /^(photo|audio):\d+:(.+)$/.exec(key);
    if (!match || !safeName(match[2])) return null;
    return match[1] === 'photo'
        ? { uri: photoUriOf(collection.clientId, match[2]), kind: 'photo' }
        : { uri: answerAudioUriOf(collection.clientId, match[2]), kind: 'audio' };
}

/** Arquivos já confirmados pelo servidor que ainda estão no aparelho. */
export function listConfirmedFiles(collections: ConfirmableCollection[]): ConfirmedFile[] {
    const found: ConfirmedFile[] = [];
    for (const collection of collections) {
        for (const key of collection.upload?.uploaded ?? []) {
            const target = uriOfKey(collection, key);
            if (!target) continue;
            const bytes = sizeIfExists(target.uri);
            if (bytes !== null) found.push({ ...target, bytes });
        }
    }
    return found;
}

/** Apaga do aparelho os arquivos já confirmados pelo servidor. Devolve quanto espaço voltou. */
export function releaseConfirmedFiles(collections: ConfirmableCollection[]): { files: number; freedBytes: number } {
    let files = 0;
    let freedBytes = 0;
    for (const file of listConfirmedFiles(collections)) {
        try {
            new File(file.uri).delete();
            files += 1;
            freedBytes += file.bytes;
        } catch (error) {
            console.log('Não foi possível apagar um arquivo já enviado:', error);
        }
    }
    return { files, freedBytes };
}

/** A coleta inteira foi confirmada: tira do aparelho tudo que era dela (pastas de fotos e áudios, áudio da entrevista). */
export function removeCollectionFiles(collection: ConfirmableCollection): void {
    deleteCollectionPhotos(collection.clientId);
    deleteCollectionAudios(collection.clientId);
    if (collection.audio?.uri) {
        try {
            const file = new File(collection.audio.uri);
            if (file.exists) file.delete();
        } catch {
            // fica como "liberável" até alguém apagar
        }
    }
}

export interface StorageReport extends StorageUsage {
    /** Já está no servidor e ainda ocupa o aparelho: pode ser apagado agora. */
    releasableBytes: number;
}

/**
 * O que a tela de envio mostra: `totalBytes` é só o que as coletas AINDA NÃO ENVIADAS ocupam (o que já foi
 * confirmado não conta, aparece à parte como "liberável").
 */
export function getStorageReport(collections: ConfirmableCollection[]): StorageReport {
    const disk = getStorageUsage(collections);

    let releasablePhotos = 0;
    let releasableAudio = 0;
    for (const file of listConfirmedFiles(collections)) {
        if (file.kind === 'photo') releasablePhotos += file.bytes;
        else releasableAudio += file.bytes;
    }

    const photosBytes = Math.max(0, disk.photosBytes - releasablePhotos);
    const audioBytes = Math.max(0, disk.audioBytes - releasableAudio);
    return {
        photosBytes,
        audioBytes,
        totalBytes: photosBytes + audioBytes,
        freeBytes: disk.freeBytes ?? getFreeSpaceBytes(),
        releasableBytes: releasablePhotos + releasableAudio,
    };
}

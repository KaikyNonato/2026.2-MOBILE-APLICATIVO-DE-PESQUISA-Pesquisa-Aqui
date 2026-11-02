import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { getQuestionAudioBytes } from './audioStorage';

// Fotos da coleta: tiradas com a câmera, reduzidas e guardadas no aparelho, ao lado da coleta.
// Nada aqui usa a internet: no momento da entrevista não há rede para subir nada.
//
// Onde ficam: `<documentos do app>/photos/<clientId da coleta>/<uuid>.jpg`. A pasta de documentos
// não é limpa pelo sistema (o cache é), então a foto sobrevive até a coleta ser enviada.

/** Lado maior da foto gravada. Um celular tira ~4000 px (3 a 8 MB); 1600 px bastam como prova de campo. */
export const PHOTO_MAX_SIDE_PX = 1600;
/** Qualidade do JPEG gravado (0 a 1). Com 1600 px e 0,7 a foto costuma ficar entre 200 e 500 KB. */
export const PHOTO_JPEG_QUALITY = 0.7;
/** Tamanho que a foto não deve passar. Se passar, é comprimida de novo, com menos qualidade e menos pixels. */
export const PHOTO_TARGET_BYTES = 350 * 1024;

/** Tentativas de compressão, da mais fiel para a mais forte. Para na primeira que couber em PHOTO_TARGET_BYTES. */
const SHRINK_STEPS: { maxSide: number; quality: number }[] = [
    { maxSide: PHOTO_MAX_SIDE_PX, quality: PHOTO_JPEG_QUALITY },
    { maxSide: 1400, quality: 0.6 },
    { maxSide: 1200, quality: 0.5 },
    { maxSide: 1024, quality: 0.4 },
];

const PHOTOS_ROOT = 'photos';

export type CapturePhotoResult =
    | { status: 'ok'; uri: string; sizeBytes: number }
    | { status: 'cancelled' }
    // Permissão negada. `canAskAgain: false` = só dá para liberar nas configurações do aparelho.
    | { status: 'denied'; canAskAgain: boolean }
    | { status: 'error'; message: string };

const collectionPhotosDir = (collectionId: string) => new Directory(Paths.document, PHOTOS_ROOT, collectionId);

/** Endereço no aparelho da foto de uma coleta, a partir do nome guardado na resposta. */
export const photoUriOf = (collectionId: string, fileName: string): string =>
    new File(collectionPhotosDir(collectionId), fileName).uri;

/** Apaga a pasta de fotos da coleta inteira (a coleta já foi confirmada pelo servidor). */
export function deleteCollectionPhotos(collectionId: string): void {
    try {
        const directory = collectionPhotosDir(collectionId);
        if (directory.exists) directory.delete();
    } catch {
        // pasta que o sistema não deixa apagar não atrapalha: o que sobrar é "liberável" na tela de envio
    }
}

// ---------- Permissão ----------

async function ensureCameraPermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
    let permission = await ImagePicker.getCameraPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
        permission = await ImagePicker.requestCameraPermissionsAsync();
    }
    return { granted: permission.granted, canAskAgain: permission.canAskAgain };
}

// ---------- Redução ----------

/** Uma passada: lado maior limitado a `maxSide` (sem esticar fotos menores) e JPEG com a qualidade dada. */
async function renderShrunk(uri: string, width: number, height: number, maxSide: number, quality: number): Promise<string> {
    const context = ImageManipulator.manipulate(uri);
    try {
        if (Math.max(width, height) > maxSide) {
            // Informar só um dos lados mantém a proporção da foto
            context.resize(width >= height ? { width: maxSide } : { height: maxSide });
        }
        const image = await context.renderAsync();
        const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality });
        return saved.uri;
    } finally {
        context.release();
    }
}

/**
 * Reduz a foto antes de gravar (e, portanto, antes de qualquer envio): começa com 1600 px e qualidade 0,7 e,
 * se o arquivo ainda passar de PHOTO_TARGET_BYTES, tenta de novo com menos pixels e mais compressão.
 * Sempre parte da foto original, para não recomprimir uma compressão. Se nenhuma tentativa couber, fica a mais forte.
 */
async function shrinkPhoto(uri: string, width: number, height: number): Promise<string> {
    let best: string | null = null;
    for (const step of SHRINK_STEPS) {
        const candidate = await renderShrunk(uri, width, height, step.maxSide, step.quality);
        if (best) deleteQuietly(best);
        best = candidate;
        if (fileBytes(candidate) <= PHOTO_TARGET_BYTES) break;
    }
    return best as string;
}

function deleteQuietly(uri: string): void {
    try {
        const file = new File(uri);
        if (file.exists) file.delete();
    } catch {
        // Arquivo temporário que já sumiu (ou que o sistema não deixa apagar) não atrapalha a coleta.
    }
}

// ---------- Captura ----------

/**
 * Abre a câmera, reduz a foto e a grava no aparelho, na pasta da coleta. Nunca lança erro:
 * permissão negada, cancelamento e falha voltam como resultado, para a tela explicar sem cair.
 */
export async function capturePhoto(collectionId: string): Promise<CapturePhotoResult> {
    try {
        const permission = await ensureCameraPermission();
        if (!permission.granted) return { status: 'denied', canAskAgain: permission.canAskAgain };

        const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
        if (picked.canceled || !picked.assets?.[0]) return { status: 'cancelled' };
        const asset = picked.assets[0];

        const shrunkUri = await shrinkPhoto(asset.uri, asset.width, asset.height);

        const directory = collectionPhotosDir(collectionId);
        directory.create({ intermediates: true, idempotent: true });
        const target = new File(directory, `${Crypto.randomUUID()}.jpg`);
        await new File(shrunkUri).copy(target);

        // A original (vários MB) e a cópia temporária não servem mais: só a reduzida fica no aparelho
        deleteQuietly(shrunkUri);
        deleteQuietly(asset.uri);

        return { status: 'ok', uri: target.uri, sizeBytes: target.size };
    } catch (error) {
        console.log('Falha ao fotografar:', error);
        return { status: 'error', message: 'Não foi possível tirar ou gravar a foto. Tente novamente.' };
    }
}

/** Apaga a foto do aparelho (ao removê-la da resposta antes do envio). */
export function deletePhoto(uri: string): void {
    deleteQuietly(uri);
}

// ---------- Espaço ocupado ----------

export interface StorageUsage {
    photosBytes: number;
    audioBytes: number;
    totalBytes: number;
    /** Espaço livre no aparelho, para comparar com o que as coletas pendentes ocupam. */
    freeBytes: number | null;
}

function fileBytes(uri: string): number {
    try {
        const file = new File(uri);
        return file.exists ? file.size : 0;
    } catch {
        return 0;
    }
}

function photosBytes(collectionId: string): number {
    try {
        const directory = collectionPhotosDir(collectionId);
        return directory.exists ? (directory.size ?? 0) : 0;
    } catch {
        return 0;
    }
}

/** Soma o que as coletas guardadas no aparelho ocupam em fotos e áudio. */
export function getStorageUsage(collections: Array<{ clientId: string; audio?: { uri: string } }>): StorageUsage {
    let photos = 0;
    let audio = 0;
    for (const collection of collections) {
        photos += photosBytes(collection.clientId);
        if (collection.audio?.uri) audio += fileBytes(collection.audio.uri);
        // Áudios das questões "responda falando"
        audio += getQuestionAudioBytes(collection.clientId);
    }

    let freeBytes: number | null = null;
    try {
        freeBytes = Paths.availableDiskSpace;
    } catch {
        freeBytes = null;
    }

    return { photosBytes: photos, audioBytes: audio, totalBytes: photos + audio, freeBytes };
}

/** "0 B", "812 KB", "12,4 MB", "1,2 GB" (pt-BR). */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** exponent;
    const text = exponent === 0 || value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace('.', ',');
    return `${text} ${units[exponent]}`;
}

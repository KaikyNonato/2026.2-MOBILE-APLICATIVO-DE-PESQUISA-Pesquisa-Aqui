import * as Crypto from 'expo-crypto';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';

// Áudios das questões "responda falando": gravados, guardados no aparelho e enviados com a coleta.
// Nada aqui usa a internet.
//
// Onde ficam: `<documentos do app>/audio/<clientId da coleta>/<uuid>.m4a`. A pasta de documentos
// não é limpa pelo sistema (o cache é), então o áudio sobrevive até a coleta ser enviada.

const AUDIO_ROOT = 'audio';

/** Abaixo disso o app avisa que o espaço está acabando (voz a 64 kbps ocupa ~28 MB por hora). */
export const LOW_SPACE_BYTES = 30 * 1024 * 1024;
/** Abaixo disso nem começa a gravar: a gravação cairia no meio. */
export const MIN_SPACE_TO_RECORD_BYTES = 15 * 1024 * 1024;

/** Pasta dos áudios de uma coleta no aparelho. */
const collectionAudioDir = (collectionId: string) => new Directory(Paths.document, AUDIO_ROOT, collectionId);

// ---------- Permissão do microfone ----------

export interface MicPermission {
    granted: boolean;
    /** false = só dá para liberar nas configurações do aparelho. */
    canAskAgain: boolean;
}

/** Pede o microfone se ainda dá para perguntar. Nunca lança erro. */
export async function ensureMicPermission(): Promise<MicPermission> {
    try {
        let permission = await getRecordingPermissionsAsync();
        if (!permission.granted && permission.canAskAgain) {
            permission = await requestRecordingPermissionsAsync();
        }
        return { granted: permission.granted, canAskAgain: permission.canAskAgain };
    } catch (error) {
        console.log('Falha ao consultar a permissão do microfone:', error);
        return { granted: false, canAskAgain: true };
    }
}

// ---------- Espaço ----------

/** Espaço livre no aparelho, ou null se o sistema não informar. */
export function getFreeSpaceBytes(): number | null {
    try {
        return Paths.availableDiskSpace;
    } catch {
        return null;
    }
}

// ---------- Arquivos ----------

/** Apaga o arquivo sem lançar erro (ignora se não existir ou se falhar). */
function deleteQuietly(uri: string): void {
    try {
        const file = new File(uri);
        if (file.exists) file.delete();
    } catch {
        // Arquivo temporário que já sumiu não atrapalha a coleta.
    }
}

/**
 * Move a gravação (que o gravador deixa numa pasta temporária) para a pasta da coleta.
 * Devolve o endereço definitivo, que é o que a resposta guarda.
 */
export async function keepAnswerAudio(tempUri: string, collectionId: string): Promise<{ uri: string; sizeBytes: number }> {
    const directory = collectionAudioDir(collectionId);
    directory.create({ intermediates: true, idempotent: true });
    const target = new File(directory, `${Crypto.randomUUID()}.m4a`);
    await new File(tempUri).copy(target);
    deleteQuietly(tempUri);
    return { uri: target.uri, sizeBytes: target.size };
}

/** Apaga o áudio do aparelho (ao regravar ou ao descartar a resposta). */
export function deleteAudio(uri: string): void {
    deleteQuietly(uri);
}

/** Endereço no aparelho do áudio de uma questão de uma coleta, a partir do nome guardado na resposta. */
export const answerAudioUriOf = (collectionId: string, fileName: string): string =>
    new File(collectionAudioDir(collectionId), fileName).uri;

/** Apaga a pasta de áudios das questões da coleta inteira (a coleta já foi confirmada pelo servidor). */
export function deleteCollectionAudios(collectionId: string): void {
    try {
        const directory = collectionAudioDir(collectionId);
        if (directory.exists) directory.delete();
    } catch {
        // pasta que o sistema não deixa apagar não atrapalha: o que sobrar é "liberável" na tela de envio
    }
}

/** Quanto os áudios das questões de uma coleta ocupam no aparelho. */
export function getQuestionAudioBytes(collectionId: string): number {
    try {
        const directory = collectionAudioDir(collectionId);
        return directory.exists ? (directory.size ?? 0) : 0;
    } catch {
        return 0;
    }
}

/** Formata segundos como mm:ss. */
export function formatClock(totalSeconds: number): string {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

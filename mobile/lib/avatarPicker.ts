import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/** Lado da foto de perfil enviada. Ela aparece pequena no app, então 512 px sobram e o arquivo fica leve. */
const AVATAR_SIDE_PX = 512;
const AVATAR_JPEG_QUALITY = 0.85;

export type PickAvatarResult =
    | { status: 'ok'; uri: string }
    | { status: 'cancelled' }
    // Permissão da câmera negada. `canAskAgain: false` = só dá para liberar nas configurações do aparelho.
    | { status: 'denied'; canAskAgain: boolean }
    | { status: 'error'; message: string };

/** Recorta (quadrado) e reduz a imagem escolhida. Devolve o JPEG pronto para enviar. */
async function shrinkAvatar(uri: string, width: number, height: number): Promise<string> {
    const context = ImageManipulator.manipulate(uri);
    try {
        if (Math.max(width, height) > AVATAR_SIDE_PX) {
            context.resize(width >= height ? { width: AVATAR_SIDE_PX } : { height: AVATAR_SIDE_PX });
        }
        const image = await context.renderAsync();
        const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: AVATAR_JPEG_QUALITY });
        return saved.uri;
    } finally {
        context.release();
    }
}

/** Apaga o arquivo sem lançar erro (ignora se não existir ou se falhar). */
function deleteQuietly(uri: string): void {
    try {
        const file = new File(uri);
        if (file.exists) file.delete();
    } catch {
        // arquivo temporário que já sumiu não atrapalha
    }
}

/**
 * Escolhe a foto de perfil na câmera ou na galeria, já com recorte quadrado.
 * Nunca lança erro: permissão negada, cancelamento e falha voltam como resultado.
 */
export async function pickAvatar(source: 'camera' | 'library'): Promise<PickAvatarResult> {
    try {
        const options: ImagePicker.ImagePickerOptions = {
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 1,
        };

        let picked: ImagePicker.ImagePickerResult;
        if (source === 'camera') {
            let permission = await ImagePicker.getCameraPermissionsAsync();
            if (!permission.granted && permission.canAskAgain) {
                permission = await ImagePicker.requestCameraPermissionsAsync();
            }
            if (!permission.granted) return { status: 'denied', canAskAgain: permission.canAskAgain };
            picked = await ImagePicker.launchCameraAsync(options);
        } else {
            picked = await ImagePicker.launchImageLibraryAsync(options);
        }

        if (picked.canceled || !picked.assets?.[0]) return { status: 'cancelled' };
        const asset = picked.assets[0];

        const uri = await shrinkAvatar(asset.uri, asset.width, asset.height);
        if (uri !== asset.uri) deleteQuietly(asset.uri);

        return { status: 'ok', uri };
    } catch (error) {
        console.log('Falha ao escolher a foto de perfil:', error);
        return { status: 'error', message: 'Não foi possível abrir a foto. Tente novamente.' };
    }
}

/** Apaga o arquivo temporário depois do envio. */
export const discardAvatarFile = deleteQuietly;

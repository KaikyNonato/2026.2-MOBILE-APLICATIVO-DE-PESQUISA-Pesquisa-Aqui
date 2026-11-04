import { createHash } from 'node:crypto';

// Limites dos arquivos enviados à parte da coleta. Configurados no servidor (variáveis de ambiente),
// lidos a cada chamada para que o valor possa mudar sem recompilar.
//   PHOTO_MAX_BYTES  - foto (padrão 30 MB; o app reduz a foto para algumas centenas de KB)
//   AUDIO_MAX_BYTES  - áudio da entrevista ou de questão (padrão 150 MB)
const MB = 1024 * 1024;

/** Lê um número positivo do ambiente; usa o valor padrão se estiver vazio ou for inválido. */
const positiveNumber = (raw: string | undefined, fallback: number) => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/** Tamanho máximo de uma foto de resposta (`PHOTO_MAX_BYTES`, padrão 30 MB). */
export const photoMaxBytes = () => positiveNumber(process.env.PHOTO_MAX_BYTES, 30 * MB);
/** Tamanho máximo de um áudio (`AUDIO_MAX_BYTES`, padrão 150 MB). */
export const audioMaxBytes = () => positiveNumber(process.env.AUDIO_MAX_BYTES, 150 * MB);
/** Maior dos dois limites: serve de teto para qualquer envio de arquivo. */
export const uploadMaxBytes = () => Math.max(photoMaxBytes(), audioMaxBytes());

/** Formata um limite em bytes como MB, para as mensagens de erro. */
export const formatLimit = (bytes: number) => `${Math.round((bytes / MB) * 10) / 10} MB`;

/**
 * O nome que o aparelho deu ao arquivo (um UUID + extensão) vira o identificador do arquivo no
 * servidor.
 * É ele que impede a duplicidade: o mesmo nome, na mesma coleta e questão, é sempre o mesmo
 * arquivo.
 * Nomes fora do padrão UUID viram um hash, e o prefixo "f" os separa das posições numéricas
 * (`q5-0.jpg`)
 * do envio antigo (tudo junto na coleta).
 */
export function fileStem(deviceFileName: string): string {
  const base = deviceFileName.replace(/\.[^.]*$/, '').trim().toLowerCase();
  if (/^[0-9a-f-]{8,40}$/.test(base)) return `f${base}`;
  return `f${createHash('sha1').update(deviceFileName).digest('hex').slice(0, 16)}`;
}

/**
 * Nome com que o servidor guarda o arquivo de uma resposta:
 * `q<questão>-<identificador>.<extensão>`.
 */
export const storedFileName = (questionId: number, deviceFileName: string, extension: string) =>
  `q${questionId}-${fileStem(deviceFileName)}.${extension}`;

/** Confere se o arquivo começa com os bytes informados (a partir de `offset`). */
const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  buffer.length >= offset + bytes.length && bytes.every((byte, i) => buffer[offset + i] === byte);

/**
 * Confere o começo do arquivo: o tipo declarado pelo aparelho não basta, o conteúdo tem de ser
 * coerente.
 */
export function looksLikeImage(buffer: Buffer): boolean {
  return (
    startsWith(buffer, [0xff, 0xd8, 0xff]) || // jpeg
    startsWith(buffer, [0x89, 0x50, 0x4e, 0x47]) || // png
    (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) || // webp
    startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4) // heic/heif (ftyp)
  );
}

/** Confere pelo começo do arquivo se ele parece mesmo um áudio (m4a/mp4, mp3, ogg, webm e outros). */
export function looksLikeAudio(buffer: Buffer): boolean {
  return (
    startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4) || // m4a, mp4, 3gp (ftyp)
    startsWith(buffer, [0x49, 0x44, 0x33]) || // mp3 com ID3
    (buffer.length > 1 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) || // mp3/aac (ADTS)
    startsWith(buffer, [0x4f, 0x67, 0x67, 0x53]) || // ogg
    startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3]) || // webm
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) // wav
  );
}

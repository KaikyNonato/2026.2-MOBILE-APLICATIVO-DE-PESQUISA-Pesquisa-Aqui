import { isAnswerEmpty, type AnswerValue, type PackageQuestion } from './displayRules';

// Cada questão chega no pacote com o seu `type` e os seus limites (cadastrados na web).
// Aqui ficam só os comportamentos por tipo: o app olha o tipo da questão, procura o
// comportamento correspondente e, se não conhece o tipo, trata como "não suportado"
// (a tela mostra um aviso e deixa avançar) em vez de quebrar.

// ---------- Limites vindos do servidor ----------

export interface QuestionLimits {
    minSelections?: number;
    maxSelections?: number;
    maxLength?: number;
    minValue?: number;
    maxValue?: number;
    minDate?: string; // AAAA-MM-DD
    maxDate?: string; // AAAA-MM-DD
    maxFiles?: number; // fotos aceitas na questão
    maxDuration?: number; // segundos de gravação aceitos na questão de áudio
}

/**
 * Duração máxima da resposta de áudio quando o servidor não cadastrou limite. Áudio pesa e o
 * aparelho guarda tudo até o envio, então a questão nunca fica sem teto.
 */
export const DEFAULT_MAX_AUDIO_SECONDS = 600;

/**
 * Quantas fotos "várias fotos" aceita quando o servidor não cadastrou limite. Foto pesa e o
 * aparelho guarda tudo até o envio, então não deixamos a questão sem teto.
 */
export const DEFAULT_MAX_PHOTOS = 10;

/** Converte o valor em número (`undefined` se vazio ou inválido). */
function toNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

/** Extrai `AAAA-MM-DD` de um texto (`undefined` se não casar). */
function toIsoDate(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/** Limites da questão: lê o objeto `validations` do pacote e cai nos campos planos se faltar. */
export function getQuestionLimits(question: PackageQuestion): QuestionLimits {
    const v = question.validations;
    const maxLength = toNumber(v?.maxLength ?? question.maxLength);
    const minSelections = toNumber(v?.minSelections ?? question.minSelections);
    const maxSelections = toNumber(v?.maxSelections ?? question.maxSelections);
    const maxFiles = toNumber(question.recording?.maxFiles ?? question.maxFiles);
    // O pacote manda a duração (em segundos) em `recording.maxDuration` e também no campo plano.
    const flatMaxDuration = (question as PackageQuestion & { maxDuration?: number | null }).maxDuration;
    const maxDuration = toNumber(question.recording?.maxDuration ?? flatMaxDuration);
    return {
        maxDuration: maxDuration !== undefined && maxDuration > 0 ? maxDuration : undefined,
        maxFiles: maxFiles !== undefined && maxFiles > 0 ? maxFiles : undefined,
        minSelections: minSelections !== undefined && minSelections > 0 ? minSelections : undefined,
        maxSelections: maxSelections !== undefined && maxSelections > 0 ? maxSelections : undefined,
        maxLength: maxLength !== undefined && maxLength > 0 ? maxLength : undefined,
        minValue: toNumber(v?.minValue ?? question.minValue),
        maxValue: toNumber(v?.maxValue ?? question.maxValue),
        minDate: toIsoDate(v?.minDate ?? question.minDate),
        maxDate: toIsoDate(v?.maxDate ?? question.maxDate),
    };
}

// ---------- Escolhas ----------

/** Texto de quantas opções podem ser marcadas ("Marque de 1 a 3 opções"), ou null se não há limite. */
export function describeSelectionRange(minSelections?: number, maxSelections?: number): string | null {
    const plural = (n: number) => (n === 1 ? 'opção' : 'opções');
    if (minSelections !== undefined && maxSelections !== undefined) {
        return minSelections === maxSelections
            ? `Marque ${minSelections} ${plural(minSelections)}`
            : `Marque de ${minSelections} a ${maxSelections} opções`;
    }
    if (minSelections !== undefined) return `Marque pelo menos ${minSelections} ${plural(minSelections)}`;
    if (maxSelections !== undefined) return `Marque até ${maxSelections} ${plural(maxSelections)}`;
    return null;
}

// ---------- Datas e horas ----------

export interface DateParts {
    day: number;
    month: number; // 1-12
    year: number;
}

/** Quantos dias tem o mês (de 1 a 12) do ano. */
export function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

/** Número comparável: 2026-10-11 -> 20261011. */
export function dateKey(d: DateParts): number {
    return d.year * 10000 + d.month * 100 + d.day;
}

/** Diz se dia, mês e ano formam uma data real. */
function isRealDate(d: DateParts): boolean {
    return d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= daysInMonth(d.year, d.month);
}

/** "DD/MM/AAAA" (como o app guarda a resposta) -> partes, ou null se não for uma data real. */
export function parseBrDate(text: string): DateParts | null {
    const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    const parts = { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) };
    return isRealDate(parts) ? parts : null;
}

/** "AAAA-MM-DD" (como o servidor manda o intervalo) -> partes. */
export function parseIsoDate(text: string | undefined): DateParts | null {
    if (!text) return null;
    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const parts = { day: Number(m[3]), month: Number(m[2]), year: Number(m[1]) };
    return isRealDate(parts) ? parts : null;
}

/** Formata a data como DD/MM/AAAA. */
export function formatBrDate(d: DateParts): string {
    return `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}/${d.year}`;
}

/** Lê `HH:MM` e devolve hora e minuto (`null` se for inválido). */
export function parseTime(text: string): { hour: number; minute: number } | null {
    const m = text.match(/^(\d{2}):(\d{2})$/);
    if (!m) return null;
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** Formata hora e minuto como `HH:MM`. */
export function formatTime(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// ---------- Numérica ----------

/** Aceita "12", "-3", "3,5" e "3.5". Qualquer outra coisa não é número. */
export function parseNumeric(text: string): number | null {
    const normalized = text.trim().replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : null;
}

/** Formata o número com vírgula decimal. */
const formatNumber = (n: number) => String(n).replace('.', ',');

// ---------- Comportamento por tipo ----------

type Validator = (question: PackageQuestion, value: AnswerValue) => string | null;

/** Valida o tamanho máximo do texto. Devolve a mensagem de erro ou `null`. */
function validateText(question: PackageQuestion, value: AnswerValue): string | null {
    const { maxLength } = getQuestionLimits(question);
    if (typeof value !== 'string' || maxLength === undefined) return null;
    return value.length > maxLength
        ? `Use no máximo ${maxLength} caracteres (a resposta tem ${value.length}).`
        : null;
}

/** Valida se o número está entre o mínimo e o máximo da questão. */
function validateNumeric(question: PackageQuestion, value: AnswerValue): string | null {
    const { minValue, maxValue } = getQuestionLimits(question);
    const n = typeof value === 'number' ? value : parseNumeric(String(value));

    if (n === null) return 'Informe apenas números (por exemplo 12 ou 3,5).';

    if (minValue !== undefined && maxValue !== undefined && (n < minValue || n > maxValue)) {
        return `Informe um número entre ${formatNumber(minValue)} e ${formatNumber(maxValue)}.`;
    }
    if (minValue !== undefined && n < minValue) return `Informe um número maior ou igual a ${formatNumber(minValue)}.`;
    if (maxValue !== undefined && n > maxValue) return `Informe um número menor ou igual a ${formatNumber(maxValue)}.`;
    return null;
}

/** Texto do intervalo de datas permitido, ou null se não há intervalo. */
export function describeDateRange(question: PackageQuestion): string | null {
    const min = parseIsoDate(getQuestionLimits(question).minDate);
    const max = parseIsoDate(getQuestionLimits(question).maxDate);
    if (min && max) return `entre ${formatBrDate(min)} e ${formatBrDate(max)}`;
    if (min) return `a partir de ${formatBrDate(min)}`;
    if (max) return `até ${formatBrDate(max)}`;
    return null;
}

/** Valida a data no formato DD/MM/AAAA e os limites da questão. */
function validateDate(question: PackageQuestion, value: AnswerValue): string | null {
    const date = typeof value === 'string' ? parseBrDate(value) : null;
    if (!date) return 'Informe uma data válida no formato DD/MM/AAAA.';

    const limits = getQuestionLimits(question);
    const min = parseIsoDate(limits.minDate);
    const max = parseIsoDate(limits.maxDate);
    const outOfRange = (min && dateKey(date) < dateKey(min)) || (max && dateKey(date) > dateKey(max));
    return outOfRange ? `Informe uma data ${describeDateRange(question)}.` : null;
}

/** Valida o horário no formato `HH:MM`. */
function validateTime(_question: PackageQuestion, value: AnswerValue): string | null {
    return typeof value === 'string' && parseTime(value) ? null : 'Informe um horário válido no formato HH:MM.';
}

/** Valida o mínimo e o máximo de alternativas marcadas. */
function validateMultipleChoice(question: PackageQuestion, value: AnswerValue): string | null {
    const { minSelections, maxSelections } = getQuestionLimits(question);
    const count = Array.isArray(value) ? value.length : 0;
    if (minSelections !== undefined && count < minSelections) {
        return `${describeSelectionRange(minSelections, maxSelections)} (${count} marcada${count === 1 ? '' : 's'}).`;
    }
    if (maxSelections !== undefined && count > maxSelections) {
        return `Marque no máximo ${maxSelections} ${maxSelections === 1 ? 'opção' : 'opções'} (${count} marcadas).`;
    }
    return null;
}

// ---------- Fotos ----------

/** Quantas fotos a questão aceita: uma em "foto"; em "várias fotos", o limite do servidor (ou o padrão). */
export function getPhotoLimit(question: PackageQuestion): number {
    if (question.type === 'PHOTO') return 1;
    return getQuestionLimits(question).maxFiles ?? DEFAULT_MAX_PHOTOS;
}

/** A resposta de foto guarda o endereço de cada arquivo no aparelho: um texto (foto) ou uma lista (várias). */
export function getPhotoUris(value: AnswerValue): string[] {
    if (typeof value === 'string') return value.trim() === '' ? [] : [value];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item !== '');
    return [];
}

/** Valida a quantidade de fotos, dentro do limite da questão. */
function validatePhotos(question: PackageQuestion, value: AnswerValue): string | null {
    const limit = getPhotoLimit(question);
    const count = getPhotoUris(value).length;
    if (count <= limit) return null;
    return `Use no máximo ${limit} ${limit === 1 ? 'foto' : 'fotos'} (${count} tiradas). Remova ${count - limit === 1 ? 'uma' : 'as que passam do limite'}.`;
}

// ---------- Áudio ----------

/** Quantos segundos a resposta de áudio pode durar: o limite do servidor (ou o padrão). */
export function getAudioMaxSeconds(question: PackageQuestion): number {
    return getQuestionLimits(question).maxDuration ?? DEFAULT_MAX_AUDIO_SECONDS;
}

export interface AudioAnswerValue {
    /** Endereço do arquivo no aparelho. */
    uri: string;
    durationSeconds: number;
}

/** A resposta de áudio guarda o endereço e a duração, serializados num texto (como o resto das respostas). */
export function serializeAudioAnswer(value: AudioAnswerValue): string {
    return JSON.stringify(value);
}

/** Lê a resposta de áudio (JSON guardado). Devolve `null` se for inválida. */
export function parseAudioAnswer(value: AnswerValue): AudioAnswerValue | null {
    if (typeof value !== 'string' || value.trim() === '') return null;
    try {
        const parsed = JSON.parse(value);
        if (typeof parsed?.uri !== 'string' || parsed.uri === '') return null;
        return { uri: parsed.uri, durationSeconds: Number(parsed.durationSeconds) || 0 };
    } catch {
        return null;
    }
}

/** Endereços locais do áudio da resposta (lista vazia se não houver). */
export function getAudioUris(value: AnswerValue): string[] {
    const audio = parseAudioAnswer(value);
    return audio ? [audio.uri] : [];
}

/** Segundos com tolerância de 1 s: a duração medida pelo gravador arredonda e pode passar por pouco. */
function validateAudio(question: PackageQuestion, value: AnswerValue): string | null {
    const audio = parseAudioAnswer(value);
    if (!audio) return 'A gravação não foi encontrada. Grave a resposta novamente.';
    const max = getAudioMaxSeconds(question);
    if (audio.durationSeconds > max + 1) {
        return `A gravação passa da duração máxima de ${max} s (tem ${audio.durationSeconds} s). Grave novamente.`;
    }
    return null;
}

// ---------- Localização ----------

/**
 * Precisão (raio de incerteza, em metros) acima da qual o ponto é gravado como "de baixa precisão".
 * Com mais que isso o ponto pode estar a dezenas ou centenas de metros de onde o pesquisador está.
 */
export const LOW_ACCURACY_THRESHOLD_METERS = 50;

export interface LocationAnswerValue {
    latitude: number;
    longitude: number;
    /** Precisão informada pelo aparelho, em metros. null = o aparelho não informou. */
    accuracy: number | null;
    /** true = precisão ruim (ou desconhecida): o administrador vê a marcação ao conferir a coleta. */
    lowAccuracy: boolean;
    /** Momento da leitura do GPS (ISO 8601), ou null em respostas antigas. */
    capturedAt: string | null;
}

/** Sem informação de precisão não dá para garantir o ponto: conta como baixa precisão. */
export function isLowAccuracy(accuracy: number | null | undefined): boolean {
    if (accuracy === null || accuracy === undefined || !Number.isFinite(accuracy) || accuracy < 0) return true;
    return accuracy > LOW_ACCURACY_THRESHOLD_METERS;
}

/** Diz se latitude e longitude são números dentro dos limites. */
const isValidCoordinate = (latitude: number, longitude: number) =>
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;

/** Cria o valor da resposta a partir da leitura do GPS (a marcação de baixa precisão sai da precisão lida). */
export function buildLocationAnswer(reading: {
    latitude: number;
    longitude: number;
    accuracy: number | null | undefined;
    capturedAt: string | null;
}): LocationAnswerValue {
    const accuracy =
        typeof reading.accuracy === 'number' && Number.isFinite(reading.accuracy) && reading.accuracy >= 0
            ? reading.accuracy
            : null;
    return {
        latitude: reading.latitude,
        longitude: reading.longitude,
        accuracy,
        lowAccuracy: isLowAccuracy(accuracy),
        capturedAt: reading.capturedAt,
    };
}

/** A resposta de localização é guardada (e enviada) como texto JSON, como as outras respostas compostas. */
export function serializeLocationAnswer(value: LocationAnswerValue): string {
    return JSON.stringify({
        latitude: value.latitude,
        longitude: value.longitude,
        accuracy: value.accuracy,
        lowAccuracy: value.lowAccuracy,
        capturedAt: value.capturedAt,
    });
}

/** Lê a resposta guardada. Aceita também o formato antigo (só latitude e longitude). */
export function parseLocationAnswer(value: AnswerValue): LocationAnswerValue | null {
    if (typeof value !== 'string' || value.trim() === '') return null;
    try {
        const parsed = JSON.parse(value);
        if (typeof parsed?.latitude !== 'number' || typeof parsed?.longitude !== 'number') return null;
        if (!isValidCoordinate(parsed.latitude, parsed.longitude)) return null;
        return buildLocationAnswer({
            latitude: parsed.latitude,
            longitude: parsed.longitude,
            accuracy: typeof parsed.accuracy === 'number' ? parsed.accuracy : null,
            capturedAt: typeof parsed.capturedAt === 'string' ? parsed.capturedAt : null,
        });
    } catch {
        return null;
    }
}

/** Baixa precisão não é erro: o pesquisador pode seguir. Só uma resposta ilegível é recusada. */
function validateLocation(_question: PackageQuestion, value: AnswerValue): string | null {
    return parseLocationAnswer(value)
        ? null
        : 'A localização guardada não é válida. Capture a localização novamente.';
}

// Tipos que a tela de coleta sabe preencher.
// Uma entrada sem validador = tipo sem regra de formato.
const QUESTION_TYPE_VALIDATORS = {
    FREE_TEXT: validateText,
    NUMERIC: validateNumeric,
    DATE: validateDate,
    TIME: validateTime,
    YES_NO: undefined,
    SINGLE_CHOICE: undefined,
    MULTIPLE_CHOICE: validateMultipleChoice,
    SCALE_1_5: undefined,
    PHOTO: validatePhotos,
    MULTIPLE_PHOTOS: validatePhotos,
    LOCATION: validateLocation,
    AUDIO: validateAudio,
} satisfies Record<string, Validator | undefined>;

export type SupportedQuestionType = keyof typeof QUESTION_TYPE_VALIDATORS;

/** O app sabe desenhar e validar este tipo? (Tipo novo no servidor = false, nunca um erro.) */
export function isQuestionTypeSupported(type: string): type is SupportedQuestionType {
    return Object.prototype.hasOwnProperty.call(QUESTION_TYPE_VALIDATORS, type);
}

/**
 * Mensagem do que era esperado quando a resposta fere o formato ou os limites da questão,
 * ou null se está tudo certo. Resposta vazia não é erro de formato (obrigatoriedade é outra regra).
 */
export function validateAnswer(question: PackageQuestion, value: AnswerValue): string | null {
    if (isAnswerEmpty(value) || !isQuestionTypeSupported(question.type)) return null;
    const validator: Validator | undefined = QUESTION_TYPE_VALIDATORS[question.type];
    return validator ? validator(question, value) : null;
}

// Aviso de espaço do aparelho. Só decide o nível e o texto; quem lê o disco é o audioStorage/photoStorage.
//
// Os limites são folgados de propósito: o pesquisador está no interior, sem rede para enviar, e uma
// entrevista de uma hora grava ~28 MB. Avisar com 500 MB livres dá tempo de enviar ou apagar algo
// antes que a foto ou a gravação falhe.

const MB = 1024 * 1024;

/** Abaixo disso o aparelho está ficando cheio: avisa. */
export const LOW_DEVICE_SPACE_BYTES = 500 * MB;
/** Abaixo disso o espaço está acabando: foto e gravação podem falhar a qualquer momento. */
export const CRITICAL_DEVICE_SPACE_BYTES = 150 * MB;

export type SpaceLevel = 'ok' | 'low' | 'critical' | 'unknown';

/** Nível do espaço livre. `null` = o sistema não informou: não avisa nada por palpite. */
export function spaceLevel(freeBytes: number | null): SpaceLevel {
    if (freeBytes === null || !Number.isFinite(freeBytes)) return 'unknown';
    if (freeBytes < CRITICAL_DEVICE_SPACE_BYTES) return 'critical';
    if (freeBytes < LOW_DEVICE_SPACE_BYTES) return 'low';
    return 'ok';
}

export interface SpaceWarning {
    level: 'low' | 'critical';
    title: string;
    text: string;
}

/**
 * O aviso que o pesquisador vê, ou null se está tudo bem.
 * `releasableBytes` = o que já está no servidor e ainda ocupa o aparelho (pode ser apagado agora). Quando se
 * sabe que existe, o aviso manda apagar isso primeiro, que é a saída que não custa nada.
 */
export function buildSpaceWarning(level: SpaceLevel, freeText: string, releasableBytes = 0): SpaceWarning | null {
    if (level !== 'low' && level !== 'critical') return null;

    const how =
        releasableBytes > 0
            ? 'Apague os arquivos já enviados na tela de envio para liberar espaço.'
            : 'Envie as coletas pendentes (cada arquivo enviado sai do aparelho) ou apague o que não usa.';

    return level === 'critical'
        ? {
            level,
            title: 'Espaço acabando',
            text: `Só ${freeText} livres. Novas fotos e gravações podem falhar. ${how}`,
        }
        : {
            level,
            title: 'Aparelho ficando cheio',
            text: `${freeText} livres. ${how}`,
        };
}

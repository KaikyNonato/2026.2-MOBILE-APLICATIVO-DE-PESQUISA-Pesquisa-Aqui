import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Envio em pedaços: o que já chegou de um arquivo grande fica aqui (sempre em disco, porque o arquivo
// cresce a cada pedaço) até o último pedaço chegar. Só então o arquivo inteiro segue para a validação
// e para o armazenamento definitivo (AudioStorage). Assim uma rede que cai no meio não obriga o app a recomeçar.
//
// Pasta: PARTIAL_UPLOAD_DIR (padrão `storage/partial`). Em produção use um disco que sobreviva a reinício,
// senão o app recomeça o arquivo do zero (o progresso é sempre perguntado ao servidor, nada se perde ou duplica).

/** Pedaço que ninguém completou em tanto tempo é lixo (o aparelho desistiu ou a coleta foi apagada). */
export const PARTIAL_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** Identidade do arquivo em andamento: coleta, questão (ou entrevista), tamanho total e nome no aparelho. */
export function partialKey(collectionId: number, questionId: number | null, totalBytes: number, name: string): string {
    return createHash('sha1').update(`${collectionId}|${questionId ?? 'interview'}|${totalBytes}|${name}`).digest('hex');
}

@Injectable()
export class PartialUploadStore {
    private get root(): string {
        if (process.env.PARTIAL_UPLOAD_DIR) return resolve(process.env.PARTIAL_UPLOAD_DIR);
        // Na Vercel (serverless) o disco do projeto é somente leitura: só /tmp aceita escrita.
        // Atenção: /tmp é por instância e some quando ela é reciclada; o app então recomeça o arquivo (nada se perde).
        if (process.env.VERCEL) return join(tmpdir(), 'pesquisa-aqui-partial');
        return resolve(join(process.cwd(), 'storage', 'partial'));
    }

    private pathOf(key: string): string {
        if (!/^[0-9a-f]{40}$/.test(key)) throw new Error('Invalid partial upload key');
        return join(this.root, `${key}.part`);
    }

    /** Quantos bytes do arquivo já chegaram (0 se ainda não começou). */
    async size(key: string): Promise<number> {
        try {
            return (await stat(this.pathOf(key))).size;
        } catch {
            return 0;
        }
    }

    /**
     * Acrescenta o pedaço que começa em `offset`. Só aceita se `offset` for exatamente o que já chegou:
     * pedaço repetido (resposta perdida) ou fora de ordem não altera o arquivo. Devolve o tamanho atual.
     */
    async append(key: string, offset: number, chunk: Buffer): Promise<number> {
        const current = await this.size(key);
        if (offset !== current) return current;
        if (current === 0) await this.purgeStale().catch(() => undefined);
        await mkdir(this.root, { recursive: true });
        await appendFile(this.pathOf(key), chunk);
        return current + chunk.length;
    }

    async read(key: string): Promise<Buffer> {
        return readFile(this.pathOf(key));
    }

    async remove(key: string): Promise<void> {
        await rm(this.pathOf(key), { force: true });
    }

    /** Apaga os pedaços abandonados. Roda quando um arquivo novo começa, então não precisa de agendador. */
    async purgeStale(now = Date.now()): Promise<void> {
        let names: string[];
        try {
            names = await readdir(this.root);
        } catch {
            return;
        }
        for (const name of names) {
            if (!name.endsWith('.part')) continue;
            const target = join(this.root, name);
            const info = await stat(target).catch(() => null);
            if (info && now - info.mtimeMs > PARTIAL_MAX_AGE_MS) await rm(target, { force: true });
        }
    }
}

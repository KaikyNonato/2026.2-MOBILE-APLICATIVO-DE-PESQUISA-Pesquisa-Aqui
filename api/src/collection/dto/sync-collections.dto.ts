import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsDateString,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import { CollectionAnswerDto, ConsentDto, StartLocationDto } from './create-collection.dto.js';

// Quantas coletas o aplicativo pode mandar de uma vez. Acima disso ele precisa dividir o envio.
export const MAX_SYNC_BATCH = 100;

// Uma coleta dentro do lote. Esta classe NÃO é validada pelo ValidationPipe junto com o lote:
// o serviço valida coleta por coleta, para que uma coleta malformada seja recusada sozinha
// e não derrube as demais.
export class SyncCollectionItemDto {
    // UUID gerado no aparelho: é a chave de idempotência (reenviar a mesma coleta não a duplica).
    @IsUUID()
    clientId: string;

    @IsInt()
    researchId: number;

    @IsDateString()
    startedAt: string;

    @IsDateString()
    finishedAt: string;

    // Opcional aqui de propósito: a ausência é recusada com o código CONSENT_REQUIRED
    // quando a pesquisa grava a entrevista.
    @IsOptional()
    @ValidateNested()
    @Type(() => ConsentDto)
    consent?: ConsentDto;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(24 * 60 * 60)
    audioDurationSeconds?: number;

    @IsOptional()
    @ValidateNested()
    @Type(() => StartLocationDto)
    startLocation?: StartLocationDto;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CollectionAnswerDto)
    answers: CollectionAnswerDto[];
}

// O lote em si. Só o "envelope" é validado aqui; o conteúdo de cada coleta fica para o serviço.
export class SyncCollectionsDto {
    // Identificação do aparelho que está enviando (gravada em cada coleta e no log de sincronização).
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    deviceId: string;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_SYNC_BATCH)
    collections: unknown[];
}

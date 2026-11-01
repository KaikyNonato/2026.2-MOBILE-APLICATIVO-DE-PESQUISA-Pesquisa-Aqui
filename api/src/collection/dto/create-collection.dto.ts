import { plainToInstance, Transform, Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsDateString,
    IsDefined,
    IsInt,
    IsLatitude,
    IsLongitude,
    IsNumber,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

// Teto de arquivos de cada tipo por coleta (o controller usa o mesmo número no limite do multipart).
export const MAX_MEDIA_FILES = 100;

export class CollectionAnswerDto {
    @IsInt()
    questionId: number;

    // Respostas de tipos compostos (múltipla escolha, localização...) chegam serializadas como texto.
    @IsString()
    value: string;
}

// Descreve um arquivo enviado junto da coleta. Vale a posição: o i-ésimo item da lista descreve o i-ésimo
// arquivo do campo multipart de mesmo nome (`photos` ou `questionAudios`).
export class CollectionMediaDto {
    @IsInt()
    questionId: number;

    // Nome do arquivo no aparelho (é o valor guardado na resposta); o servidor não o usa como caminho.
    @IsOptional()
    @IsString()
    @MaxLength(255)
    name?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(24 * 60 * 60)
    durationSeconds?: number;
}

// Local onde a entrevista começou (GPS do aparelho). Usado no mapa de coletas e na auditoria de qualidade.
export class StartLocationDto {
    @IsLatitude()
    latitude: number;

    @IsLongitude()
    longitude: number;

    // Precisão em metros (opcional; o GPS nem sempre informa).
    @IsOptional()
    @IsNumber()
    @Min(0)
    accuracy?: number | null;
}

export class ConsentDto {
    @IsBoolean()
    accepted: boolean;

    // Data e hora em que o aplicativo registrou o aceite do entrevistado.
    @IsDateString()
    acceptedAt: string;
}

export class CollectionPayloadDto {
    @IsInt()
    researchId: number;

    // Identificador gerado no aparelho: reenviar a mesma coleta não a duplica.
    @IsOptional()
    @IsString()
    @MaxLength(100)
    clientId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    deviceId?: string;

    @IsDateString()
    startedAt: string;

    @IsDateString()
    finishedAt: string;

    // Opcional aqui de propósito: a ausência dele é recusada pelo serviço com o código
    // CONSENT_REQUIRED quando a pesquisa grava a entrevista.
    @IsOptional()
    @ValidateNested()
    @Type(() => ConsentDto)
    consent?: ConsentDto;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CollectionAnswerDto)
    answers: CollectionAnswerDto[];

    @IsOptional()
    @ValidateNested()
    @Type(() => StartLocationDto)
    startLocation?: StartLocationDto;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(24 * 60 * 60)
    audioDurationSeconds?: number;

    // Fotos (questões de foto e várias fotos) e áudios de questão que seguem como arquivos na mesma requisição.
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_MEDIA_FILES)
    @ValidateNested({ each: true })
    @Type(() => CollectionMediaDto)
    photos?: CollectionMediaDto[];

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_MEDIA_FILES)
    @ValidateNested({ each: true })
    @Type(() => CollectionMediaDto)
    questionAudios?: CollectionMediaDto[];
}

// A coleta chega em multipart: o campo de texto `payload` (JSON) e, opcionalmente, o arquivo `audio`.
// Também aceita `payload` já como objeto quando enviada em JSON puro (coleta sem áudio).
export class CreateCollectionDto {
    @IsDefined()
    @Transform(({ value }) => {
        if (typeof value !== 'string') return value;
        try {
            // Tem de virar instância do DTO: com um objeto comum o `whitelist` do ValidationPipe
            // não acha nenhuma regra e apaga todos os campos (researchId, respostas, consentimento...).
            return plainToInstance(CollectionPayloadDto, JSON.parse(value));
        } catch {
            return undefined; // vira erro de validação (payload ausente)
        }
    })
    @ValidateNested()
    @Type(() => CollectionPayloadDto)
    payload: CollectionPayloadDto;
}

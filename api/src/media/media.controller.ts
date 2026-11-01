import { BadRequestException, Controller, Get, Headers, Param, ParseIntPipe, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { MediaService, type CompanyImageKind, type MediaImage } from './media.service.js';

// Imagens (foto de perfil, logo e capa da empresa) entregues pela API. `?w=` e `?h=` pedem um tamanho menor; `?v=` é a
// versão da imagem: com ela o navegador guarda a imagem por um ano, e uma troca muda o valor e força a baixar a nova.
// Listas com muitas fotos de perfil fazem dezenas de requisições de imagem de uma vez: ficam fora do limite geral.
// O acesso já exige login.
@SkipThrottle()
@Controller('media')
@UseGuards(AuthGuard)
export class MediaController {
    constructor(private readonly mediaService: MediaService) { }

    private send(image: MediaImage, version: string | undefined, res: Response) {
        res.setHeader('Cache-Control', version ? 'private, max-age=31536000, immutable' : 'private, max-age=300');
        res.setHeader('Vary', 'Accept');
        res.setHeader('X-Content-Type-Options', 'nosniff');

        return new StreamableFile(image.buffer, { type: image.contentType });
    }

    @Get('avatars/:userId')
    async avatar(
        @Param('userId', ParseIntPipe) userId: number,
        @Query('w') width: string | undefined,
        @Query('v') version: string | undefined,
        @Headers('accept') accept: string | undefined,
        @CurrentUser() viewer: UserPayLoad,
        @Res({ passthrough: true }) res: Response,
    ) {
        return this.send(await this.mediaService.avatar(userId, viewer, width, accept), version, res);
    }

    @Get('companies/:companyId/:kind')
    async companyImage(
        @Param('companyId', ParseIntPipe) companyId: number,
        @Param('kind') kind: string,
        @Query('w') width: string | undefined,
        @Query('h') height: string | undefined,
        @Query('v') version: string | undefined,
        @Headers('accept') accept: string | undefined,
        @CurrentUser() viewer: UserPayLoad,
        @Res({ passthrough: true }) res: Response,
    ) {
        if (kind !== 'logo' && kind !== 'cover') throw new BadRequestException('Invalid image kind');

        return this.send(
            await this.mediaService.companyImage(companyId, kind as CompanyImageKind, viewer, width, height, accept),
            version,
            res,
        );
    }
}

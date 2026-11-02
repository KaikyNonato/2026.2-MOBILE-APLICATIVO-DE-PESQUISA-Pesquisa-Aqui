import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, UseGuards, Headers, Header, Query, StreamableFile } from '@nestjs/common';
import { ResearchService } from './research.service.js';
import { ResearchReportService } from './research-report.service.js';
import { ResearchTemplateService } from './research-template.service.js';
import { CreateFromSavedDto, CreateFromTemplateDto, DuplicateResearchDto, SaveTemplateDto } from './dto/research-template.dto.js';
import { CreateResearchDto } from './dto/create-research.dto.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { UpdateResearchDto } from './dto/update-research.dto.js';
import { LinkResearcherDto } from './dto/link-researcher.dto.js';
import { UpdateResearcherTargetDto } from './dto/update-researcher-target.dto.js';
import { RevokeCopyDto } from './dto/revoke-copy.dto.js';
import { TeamPageQueryDto, CopiesPageQueryDto, isPaged, normalizeText, paginateList, ResearchPageQueryDto, PageQueryDto } from '../common/pagination.js';

@UseGuards(AuthGuard)
@Controller('research')
export class ResearchController {
    constructor(
        private researchService: ResearchService,
        private reportService: ResearchReportService,
        private templateService: ResearchTemplateService,
    ) { }

    @Post()
    create(@Body() createResearchDto: CreateResearchDto, @CurrentUser() currentUser: UserPayLoad) {
        return this.researchService.create(createResearchDto, currentUser);
    }

    // O aplicativo envia `X-Device-ID`: para o pesquisador, cada pesquisa volta com `copyStatus` (a cópia deste aparelho).
    @Get()
    // Painel web: `?page=&pageSize=&q=&status=&sort=` devolve só uma página ({ items, total, ... }).
    // Sem `page`/`pageSize` (aplicativo) a lista continua inteira, no formato antigo.
    findAll(
        @Headers('x-device-id') deviceId: string | undefined,
        @Query() query: ResearchPageQueryDto,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        if (isPaged(query) && currentUser.profile !== 'RESEARCHER') return this.researchService.findPage(query, currentUser);
        return this.researchService.findAll(currentUser, deviceId?.trim() || undefined);
    }

    // Contagem por situação, sem listar as pesquisas (precisa vir antes de ":id").
    @Get('summary')
    summary(@CurrentUser() currentUser: UserPayLoad) {
        return this.researchService.summary(currentUser);
    }

    // Biblioteca de questionários prontos (precisa vir antes de ":id").
    @Get('templates')
    templates() {
        return this.templateService.listTemplates();
    }

    // Cria uma pesquisa em rascunho a partir de um modelo pronto.
    @Post('from-template')
    fromTemplate(@Body() dto: CreateFromTemplateDto, @CurrentUser() currentUser: UserPayLoad) {
        return this.templateService.fromTemplate(dto, currentUser);
    }

    // Modelos salvos pela empresa (precisam vir antes de ":id").
    @Get('saved-templates')
    savedTemplates(@CurrentUser() currentUser: UserPayLoad) {
        return this.templateService.listSaved(currentUser);
    }

    // Guarda um modelo importado de arquivo JSON.
    @Post('saved-templates')
    saveTemplate(@Body() dto: SaveTemplateDto, @CurrentUser() currentUser: UserPayLoad) {
        return this.templateService.saveTemplate(dto, currentUser);
    }

    // Cria um rascunho a partir de um modelo salvo.
    @Post('saved-templates/:templateId/use')
    useSavedTemplate(@Param('templateId', ParseIntPipe) templateId: number, @Body() dto: CreateFromSavedDto, @CurrentUser() currentUser: UserPayLoad) {
        return this.templateService.fromSaved(templateId, dto, currentUser);
    }

    @Delete('saved-templates/:templateId')
    deleteSavedTemplate(@Param('templateId', ParseIntPipe) templateId: number, @CurrentUser() currentUser: UserPayLoad) {
        return this.templateService.deleteSaved(templateId, currentUser);
    }

    // Salva a estrutura desta pesquisa como modelo da empresa.
    @Post(':id/save-as-template')
    saveAsTemplate(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad) {
        return this.templateService.saveResearchAsTemplate(id, currentUser);
    }

    // Duplica a estrutura da pesquisa (seções, questões, opções e regras) em um novo rascunho.
    @Post(':id/duplicate')
    duplicate(@Param('id', ParseIntPipe) id: number, @Body() dto: DuplicateResearchDto, @CurrentUser() currentUser: UserPayLoad) {
        return this.templateService.duplicate(id, dto, currentUser);
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad) {
        return this.researchService.findOneWithLock(id, currentUser);
    }

    @Patch(':id')
    update(@Param('id', ParseIntPipe) id: number, @Body() updateResearchDto: UpdateResearchDto, @CurrentUser() currentUser: UserPayLoad) {
        return this.researchService.update(id, updateResearchDto, currentUser)
    }

    @Delete(':id')
    delete(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad) {
        return this.researchService.delete(id, currentUser);
    }

    @Post(':id/publish')
    publish(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad) {
        return this.researchService.publish(id, currentUser);
    }

    // Voltar para rascunho: só pesquisa publicada que nenhum pesquisador baixou.
    @Post(':id/unpublish')
    @HttpCode(200)
    unpublish(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad) {
        return this.researchService.unpublish(id, currentUser);
    }

    // Encerrar: bloqueia coleta nova e congela o resultado. Só administrador.
    @Post(':id/close')
    @HttpCode(200)
    close(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad) {
        return this.researchService.close(id, currentUser);
    }

    // Painel quase em tempo real (total, por pesquisador, meta, última sincronização, tempo médio). Filtros: from, to, researcherId.
    @Get(':id/panel')
    @Header('Cache-Control', 'private, no-store')
    panel(@Param('id', ParseIntPipe) id: number, @Query() query: ReportQueryDto, @CurrentUser() currentUser: UserPayLoad) {
        return this.reportService.panel(id, toReportQuery(query), currentUser);
    }

    // Relatório: um gráfico por questão de escolha e sim/não, com os mesmos filtros do painel.
    @Get(':id/report')
    @Header('Cache-Control', 'private, no-store')
    report(@Param('id', ParseIntPipe) id: number, @Query() query: ReportQueryDto, @CurrentUser() currentUser: UserPayLoad) {
        return this.reportService.report(id, toReportQuery(query), currentUser);
    }

    // CSV com uma linha por coleta e uma coluna por questão, com os mesmos filtros.
    @Get(':id/export.csv')
    @Header('Cache-Control', 'private, no-store')
    @Header('X-Content-Type-Options', 'nosniff')
    async exportCsv(@Param('id', ParseIntPipe) id: number, @Query() query: ReportQueryDto, @CurrentUser() currentUser: UserPayLoad) {
        const { fileName, content } = await this.reportService.exportCsv(id, toReportQuery(query), currentUser);
        return new StreamableFile(Buffer.from(content, 'utf8'), {
            type: 'text/csv; charset=utf-8',
            disposition: `attachment; filename="${fileName}"`,
        });
    }

    // Auditoria de qualidade das coletas (`?flagged=true`: só as com alerta de atenção).
    @Get(':id/quality')
    @Header('Cache-Control', 'private, no-store')
    quality(@Param('id', ParseIntPipe) id: number, @Query() query: ReportQueryDto, @CurrentUser() currentUser: UserPayLoad) {
        return this.reportService.quality(id, toReportQuery(query), currentUser);
    }

    // Mapa de coletas: onde cada entrevista começou, com os mesmos filtros do painel.
    @Get(':id/map')
    @Header('Cache-Control', 'private, no-store')
    map(@Param('id', ParseIntPipe) id: number, @Query() query: ReportQueryDto, @CurrentUser() currentUser: UserPayLoad) {
        return this.reportService.map(id, toReportQuery(query), currentUser);
    }

    @Get(':id/export.xlsx')
    @Header('Cache-Control', 'private, no-store')
    @Header('X-Content-Type-Options', 'nosniff')
    async exportXlsx(@Param('id', ParseIntPipe) id: number, @Query() query: ReportQueryDto, @CurrentUser() currentUser: UserPayLoad) {
        const { fileName, content } = await this.reportService.exportXlsx(id, toReportQuery(query), currentUser);
        return new StreamableFile(content, {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            disposition: `attachment; filename="${fileName}"`,
        });
    }

    @Get(':id/export.json')
    @Header('Cache-Control', 'private, no-store')
    @Header('X-Content-Type-Options', 'nosniff')
    async exportJson(@Param('id', ParseIntPipe) id: number, @Query() query: ReportQueryDto, @CurrentUser() currentUser: UserPayLoad) {
        const { fileName, content } = await this.reportService.exportJson(id, toReportQuery(query), currentUser);
        return new StreamableFile(Buffer.from(content, 'utf8'), {
            type: 'application/json; charset=utf-8',
            disposition: `attachment; filename="${fileName}"`,
        });
    }

    @Get(':id/report.pdf')
    @Header('Cache-Control', 'private, no-store')
    @Header('X-Content-Type-Options', 'nosniff')
    async exportPdf(@Param('id', ParseIntPipe) id: number, @Query() query: ReportQueryDto, @CurrentUser() currentUser: UserPayLoad) {
        const { fileName, content } = await this.reportService.exportPdf(id, toReportQuery(query), currentUser);
        return new StreamableFile(content, { type: 'application/pdf', disposition: `attachment; filename="${fileName}"` });
    }

    @Get(':id/researchers')
    // Painel web: `?page=&pageSize=&q=` devolve só uma página dos vínculos. Sem `page`/`pageSize`, lista inteira.
    async listResearchers(@Param('id', ParseIntPipe) id: number, @Query() query: PageQueryDto, @CurrentUser() currentUser: UserPayLoad) {
        const rows = await this.researchService.listResearchers(id, currentUser);
        if (!isPaged(query)) return rows;
        const term = normalizeText(query.q?.trim());
        const matching = term ? rows.filter((r) => normalizeText(`${r.name ?? ''} ${r.username ?? ''}`).includes(term)) : rows;
        return paginateList(matching, query);
    }

    // Pesquisadores da empresa com o vínculo de cada um, em páginas: `?page=&pageSize=&q=&sort=&filter=`.
    @Get(':id/team')
    team(@Param('id', ParseIntPipe) id: number, @Query() query: TeamPageQueryDto, @CurrentUser() currentUser: UserPayLoad) {
        return this.researchService.teamPage(id, query, currentUser);
    }

    @Post(':id/researchers/:userId')
    addResearcher(
        @Param('id', ParseIntPipe) id: number,
        @Param('userId', ParseIntPipe) userId: number,
        @Body() body: LinkResearcherDto,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        return this.researchService.addResearcher(id, userId, currentUser, body?.targetCount);
    }

    @Patch(':id/researchers/:userId')
    updateResearcherTarget(
        @Param('id', ParseIntPipe) id: number,
        @Param('userId', ParseIntPipe) userId: number,
        @Body() body: UpdateResearcherTargetDto,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        return this.researchService.updateResearcherTarget(id, userId, body.targetCount, currentUser);
    }

    @Delete(':id/researchers/:userId')
    removeResearcher(
        @Param('id', ParseIntPipe) id: number,
        @Param('userId', ParseIntPipe) userId: number,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        return this.researchService.removeResearcher(id, userId, currentUser);
    }

    // Quem está com a pesquisa baixada (cópias ativas + histórico de devoluções e revogações). Só administrador.
    @Get(':id/copies')
    // Painel web: `?page=&pageSize=&status=&q=` devolve ativas + usuários revogados + o histórico em páginas.
    listCopies(@Param('id', ParseIntPipe) id: number, @Query() query: CopiesPageQueryDto, @CurrentUser() currentUser: UserPayLoad) {
        if (isPaged(query)) return this.researchService.listCopiesPage(id, query, currentUser);
        return this.researchService.listCopies(id, currentUser);
    }

    // Revogação forçada de uma cópia (aparelho perdido, quebrado, pesquisador que saiu). Só administrador.
    @Post(':id/copies/:copyId/revoke')
    @HttpCode(200)
    revokeCopy(
        @Param('id', ParseIntPipe) id: number,
        @Param('copyId', ParseIntPipe) copyId: number,
        @Body() body: RevokeCopyDto,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        return this.researchService.revokeActiveCopy(id, copyId, body?.reason, currentUser);
    }

    // Desbloquear aparelho: desfaz a revogação para o aparelho voltar a baixar a pesquisa. Só administrador.
    @Post(':id/copies/:copyId/unblock')
    @HttpCode(200)
    unblockDevice(
        @Param('id', ParseIntPipe) id: number,
        @Param('copyId', ParseIntPipe) copyId: number,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        return this.researchService.unblockCopyDevice(id, copyId, currentUser);
    }

    // Devolução da cópia pelo próprio aparelho (identificado por `X-Device-ID`).
    @Post(':id/return')
    @HttpCode(200)
    returnCopy(
        @Param('id', ParseIntPipe) id: number,
        @Headers('x-device-id') deviceId: string | undefined,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        return this.researchService.returnOwnCopy(id, requireDeviceId(deviceId), currentUser);
    }

    @Get(':id/download')
    download(
        @Param('id', ParseIntPipe) id: number,
        @Headers('x-device-id') deviceId: string | undefined,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        return this.researchService.downloadPackage(id, requireDeviceId(deviceId), currentUser);
    }
}

type ReportQueryDto = { from?: string; to?: string; researcherId?: string; flagged?: string };

function toReportQuery(query: ReportQueryDto) {
    let researcherId: number | undefined;
    if (query.researcherId !== undefined && query.researcherId !== '') {
        researcherId = Number(query.researcherId);
        if (!Number.isInteger(researcherId)) throw new BadRequestException('researcherId inválido.');
    }
    return { from: query.from || undefined, to: query.to || undefined, researcherId, flagged: query.flagged === 'true' };
}

// A cópia é registrada por pesquisador + aparelho: sem aparelho identificado não há como registrá-la.
function requireDeviceId(deviceId: string | undefined): string {
    const value = deviceId?.trim();
    if (!value) throw new BadRequestException('Aparelho não identificado: envie o cabeçalho X-Device-ID.');
    return value.slice(0, 200);
}

import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CompanyService } from './company.service.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { isPaged, SituationPageQueryDto } from '../common/pagination.js';
import { AVATAR_MAX_BYTES, type CompanyImageKind, type UploadedImage } from '../auth/avatar-storage.js';

/** Valida o tipo de imagem da rota (`logo` ou `cover`). Outro valor gera erro 400. */
const imageKindOf = (kind: string): CompanyImageKind => {
  if (kind !== 'logo' && kind !== 'cover') throw new BadRequestException('Invalid image kind');
  return kind;
};

/** Rotas de empresas (`/company`). Todas exigem login. */
@UseGuards(AuthGuard)
@Controller('company')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) { }

  /**
   * Painel web: `?page=&pageSize=&q=&situation=&sort=` devolve só uma página. Sem
   * `page`/`pageSize`, lista inteira.
   */
  @Get()
  findAll(@Query() query: SituationPageQueryDto, @CurrentUser() user: UserPayLoad) {
    console.log('Quem está chamando a rota:', user);
    if (isPaged(query)) return this.companyService.findPage(query, user);
    return this.companyService.findAll(user);
  }

  /** Totais da tela de empresas, sem listar nada (precisa vir antes de ":id"). */
  @Get('stats')
  stats(@CurrentUser() user: UserPayLoad) {
    return this.companyService.stats(user);
  }

  /** Cadastra uma empresa (`POST /company`). */
  @Post()
  create(@Body() createCompanyDto: CreateCompanyDto, @CurrentUser() user: UserPayLoad) {
    return this.companyService.create(createCompanyDto, user);
  }

  /** Edita uma empresa (`PUT /company/:id`). */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCompanyDto: UpdateCompanyDto,
    @CurrentUser() currentUser: UserPayLoad,
  ) {
    return this.companyService.update(id, updateCompanyDto, currentUser);
  }

  /**
   * Logo (`kind` = logo) e capa (`kind` = cover) da empresa. multipart/form-data, campo `file`:
   * JPG, PNG ou WebP até 5 MB.
   */
  @Post(':id/images/:kind')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }))
  setImage(
    @Param('id', ParseIntPipe) id: number,
    @Param('kind') kind: string,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() currentUser: UserPayLoad,
  ) {
    return this.companyService.setImage(id, imageKindOf(kind), file, currentUser);
  }

  /** Remove o logo ou a capa da empresa (`DELETE /company/:id/images/:kind`). */
  @Delete(':id/images/:kind')
  removeImage(
    @Param('id', ParseIntPipe) id: number,
    @Param('kind') kind: string,
    @CurrentUser() currentUser: UserPayLoad,
  ) {
    return this.companyService.removeImage(id, imageKindOf(kind), currentUser);
  }

  /** Desativa uma empresa sem apagar os dados (`PATCH /company/:id`). */
  @Patch(':id')
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad) {
    return this.companyService.deactivate(id, currentUser);
  }

  /** Exclui uma empresa (`DELETE /company/:id`). */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: UserPayLoad) {
    return this.companyService.remove(id, currentUser);
  }
}

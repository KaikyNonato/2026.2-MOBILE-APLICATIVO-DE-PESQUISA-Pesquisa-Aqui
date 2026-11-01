import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserService } from './user.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UpdateUserSituationDto } from './dto/update-user-situation.dto.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserPayLoad } from '../auth/current-user.type.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { isPaged, UserPageQueryDto } from '../common/pagination.js';

@UseGuards(AuthGuard)
@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService) { }

    @Post()
    create(@Body() createUserDto: CreateUserDto, @CurrentUser() currentUser: UserPayLoad) {
        return this.userService.create(createUserDto, currentUser);
    }

    @Get()
    // Painel web: `?page=&pageSize=&q=&profile=&situation=&sort=` devolve só uma página. Sem `page`/`pageSize`, lista inteira.
    findAll(@Query() query: UserPageQueryDto, @CurrentUser() currentUser: UserPayLoad) {
        if (isPaged(query)) return this.userService.findPage(query, currentUser);
        return this.userService.findAll(currentUser);
    }

    // Totais do painel de pesquisadores, sem listar ninguém.
    @Get('/researchers/stats')
    researcherStats(@CurrentUser() currentUser: UserPayLoad) {
        return this.userService.researcherStats(currentUser);
    }

    @Get('/admins')
    findAllAdmin(@Query() query: UserPageQueryDto, @CurrentUser() currentUser: UserPayLoad) {
        if (isPaged(query)) return this.userService.findPage(query, currentUser, true);
        return this.userService.findAllAdmin(currentUser);
    }

    // Bloqueia/libera o app para todos os pesquisadores da empresa (precisa vir antes de ":username/...").
    @Patch('researchers/situation')
    setResearchersSituation(@Body() dto: UpdateUserSituationDto, @CurrentUser() currentUser: UserPayLoad) {
        return this.userService.setResearchersSituation(dto.situation, currentUser);
    }

    @Patch(':username')
    update(
        @Param('username') username: string,
        @Body() updateUserDto: UpdateUserDto,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        return this.userService.update(username, updateUserDto, currentUser);
    }

    // Gera uma senha temporária (mostrada uma única vez) e obriga a troca no próximo acesso.
    @Post(':username/reset-password')
    @HttpCode(200)
    resetPassword(@Param('username') username: string, @CurrentUser() currentUser: UserPayLoad) {
        return this.userService.resetPassword(username, currentUser);
    }

    @Patch(':username/situation')
    setSituation(
        @Param('username') username: string,
        @Body() updateUserSituationDto: UpdateUserSituationDto,
        @CurrentUser() currentUser: UserPayLoad,
    ) {
        return this.userService.setSituation(username, updateUserSituationDto.situation, currentUser);
    }

    @Delete(':username')
    delete(@Param('username') username: string, @CurrentUser() currentUser: UserPayLoad) {
        return this.userService.delete(username, currentUser);
    }
}

import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, UsePipes, ValidationPipe, Query } from '@nestjs/common'
import { RegistryService } from './registry.service'
import { RegistryDto, UpdateRegistryDto, FindRegistryDto } from './registry.dto'
import { JwtAuthGuard } from '../auth/guards/jwt.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/user.decorator'
import { Auth } from '../auth/decorators/auth.decorator'

@Controller('registries')
export class UserRegistryController {
  constructor(private readonly registryService: RegistryService) {}

  @Get()
  @Auth()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async findAll(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query() query: FindRegistryDto
  ) {
    // Если переданы параметры фильтрации/пагинации - используем новый метод
    if (query.search || query.page || query.limit || query.sortBy || query.sortOrder) {
      return this.registryService.findAllWithPagination(query, userId, userRole)
    }
    // Для обратной совместимости - старый метод
    return this.registryService.findAll(userId, userRole, query.clientTIN)
  }

  @Get(':id')
  @Auth()
  async findOne(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.registryService.findOne(id, userId, userRole)
  }
}

@Controller('admin/registries')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminRegistryController {
  constructor(private readonly registryService: RegistryService) {}

  @Get()
  @Roles('ADMIN')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async findAll(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query() query: FindRegistryDto
  ) {
    // Если переданы параметры фильтрации/пагинации - используем новый метод
    if (query.search || query.page || query.limit || query.sortBy || query.sortOrder) {
      return this.registryService.findAllWithPagination(query, userId, userRole)
    }
    // Для обратной совместимости - старый метод
    return this.registryService.findAll(userId, userRole, query.clientTIN)
  }

  @Get(':id')
  @Roles('ADMIN')
  async findOne(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.registryService.findOne(id, userId, userRole)
  }

  @Post()
  @Roles('ADMIN')
  @UsePipes(new ValidationPipe())
  async create(@Body() dto: RegistryDto, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.registryService.create(dto, userId, userRole)
  }

  @Put(':id')
  @Roles('ADMIN')
  @UsePipes(new ValidationPipe())
  async update(@Param('id') id: string, @Body() dto: UpdateRegistryDto, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.registryService.update(id, dto, userId, userRole)
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.registryService.remove(id, userId, userRole)
  }
}


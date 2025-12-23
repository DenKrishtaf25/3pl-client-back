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
  @UsePipes(new ValidationPipe({ 
    transform: true, 
    whitelist: true,
    forbidNonWhitelisted: false, // Разрешаем дополнительные параметры для длинных query строк
    skipMissingProperties: false,
    transformOptions: {
      enableImplicitConversion: true,
    }
  }))
  async findAll(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query() query: FindRegistryDto
  ) {
    // Всегда используем пагинацию по умолчанию для предотвращения таймаутов
    const page = query.page || 1
    const limit = query.limit || 20
    
    return this.registryService.findAllWithPagination(
      { ...query, page, limit },
      userId,
      userRole
    )
  }

  @Get('meta/last-import')
  @Auth()
  async getLastImportInfo() {
    return this.registryService.getLastImportInfo()
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
  @UsePipes(new ValidationPipe({ 
    transform: true, 
    whitelist: true,
    forbidNonWhitelisted: false, // Разрешаем дополнительные параметры для длинных query строк
    skipMissingProperties: false,
    transformOptions: {
      enableImplicitConversion: true,
    }
  }))
  async findAll(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query() query: FindRegistryDto
  ) {
    // Всегда используем пагинацию по умолчанию для предотвращения таймаутов
    const page = query.page || 1
    const limit = query.limit || 20
    
    return this.registryService.findAllWithPagination(
      { ...query, page, limit },
      userId,
      userRole
    )
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


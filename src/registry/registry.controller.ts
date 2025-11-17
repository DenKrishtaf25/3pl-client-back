import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, UsePipes, ValidationPipe, Query } from '@nestjs/common'
import { RegistryService } from './registry.service'
import { RegistryDto, UpdateRegistryDto } from './registry.dto'
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard'
import { RolesGuard } from 'src/auth/guards/roles.guard'
import { Roles } from 'src/auth/decorators/roles.decorator'
import { CurrentUser } from 'src/auth/decorators/user.decorator'
import { Auth } from 'src/auth/decorators/auth.decorator'

@Controller('registries')
export class UserRegistryController {
  constructor(private readonly registryService: RegistryService) {}

  @Get()
  @Auth()
  async findAll(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query('clientTIN') clientTIN?: string
  ) {
    return this.registryService.findAll(userId, userRole, clientTIN)
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
  async findAll(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query('clientTIN') clientTIN?: string
  ) {
    return this.registryService.findAll(userId, userRole, clientTIN)
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


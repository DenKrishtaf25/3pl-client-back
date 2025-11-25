import { Body, Controller, Get, Param, Post, Put, Delete, UseGuards, Query, UsePipes, ValidationPipe } from '@nestjs/common'
import { ClientService } from './client.service'
import { ClientDto, FindClientsDto } from './client.dto'
import { JwtAuthGuard } from '../auth/guards/jwt.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'

@Controller('admin/clients')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminClientsController {
  constructor(private readonly clientService: ClientService) {}

  @Get()
  @Roles('ADMIN')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async findAll(@Query() query: FindClientsDto) {
    // Если переданы параметры фильтрации - используем новый метод
    if (query.search || query.page || query.limit || query.sortBy || query.sortOrder) {
      return this.clientService.findAllWithPagination(query)
    }
    // Для обратной совместимости - старый метод без фильтрации
    return this.clientService.findAll()
  }

  @Post()
  @Roles('ADMIN')
  async create(@Body() dto: ClientDto) {
    return this.clientService.create(dto)
  }

  @Put(':id')
  @Roles('ADMIN')
  async update(@Param('id') id: string, @Body() dto: ClientDto) {
    return this.clientService.update(id, dto)
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id') id: string) {
    return this.clientService.remove(id)
  }
}

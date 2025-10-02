import { Body, Controller, Get, Param, Post, Put, Delete, UseGuards } from '@nestjs/common'
import { ClientService } from './client.service'
import { ClientDto } from './client.dto'
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard'
import { RolesGuard } from 'src/auth/guards/roles.guard'
import { Roles } from 'src/auth/decorators/roles.decorator'

@Controller('admin/clients')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminClientsController {
  constructor(private readonly clientService: ClientService) {}

  @Get()
  @Roles('ADMIN')
  async findAll() {
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

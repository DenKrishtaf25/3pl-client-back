import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, UsePipes, ValidationPipe, Query } from '@nestjs/common'
import { StockService } from './stock.service'
import { StockDto, UpdateStockDto } from './stock.dto'
import { JwtAuthGuard } from '../auth/guards/jwt.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/user.decorator'
import { Auth } from '../auth/decorators/auth.decorator'

@Controller('stocks')
export class UserStockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  @Auth()
  async findAll(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query('clientTIN') clientTIN?: string
  ) {
    return this.stockService.findAll(userId, userRole, clientTIN)
  }

  @Get(':id')
  @Auth()
  async findOne(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.stockService.findOne(id, userId, userRole)
  }
}

@Controller('admin/stocks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminStockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  @Roles('ADMIN')
  async findAll(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query('clientTIN') clientTIN?: string
  ) {
    return this.stockService.findAll(userId, userRole, clientTIN)
  }

  @Get(':id')
  @Roles('ADMIN')
  async findOne(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.stockService.findOne(id, userId, userRole)
  }

  @Post()
  @Roles('ADMIN')
  @UsePipes(new ValidationPipe())
  async create(@Body() dto: StockDto, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.stockService.create(dto, userId, userRole)
  }

  @Put(':id')
  @Roles('ADMIN')
  @UsePipes(new ValidationPipe())
  async update(@Param('id') id: string, @Body() dto: UpdateStockDto, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.stockService.update(id, dto, userId, userRole)
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.stockService.remove(id, userId, userRole)
  }
}


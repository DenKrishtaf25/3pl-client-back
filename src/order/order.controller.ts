import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, UsePipes, ValidationPipe, Query } from '@nestjs/common'
import { OrderService } from './order.service'
import { OrderDto, UpdateOrderDto, FindOrderDto } from './order.dto'
import { JwtAuthGuard } from '../auth/guards/jwt.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/user.decorator'
import { Auth } from '../auth/decorators/auth.decorator'

@Controller('orders')
export class UserOrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @Auth()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async findAll(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query() query: FindOrderDto
  ) {
    // Если переданы параметры фильтрации/пагинации - используем новый метод
    if (query.search || query.page || query.limit || query.sortBy || query.sortOrder || 
        query.acceptanceDateFrom || query.acceptanceDateTo || 
        query.exportDateFrom || query.exportDateTo || 
        query.shipmentDateFrom || query.shipmentDateTo) {
      return this.orderService.findAllWithPagination(query, userId, userRole)
    }
    // Для обратной совместимости - старый метод
    return this.orderService.findAll(userId, userRole, query.clientTIN)
  }

  @Get(':id')
  @Auth()
  async findOne(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.orderService.findOne(id, userId, userRole)
  }
}

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminOrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @Roles('ADMIN')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async findAll(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query() query: FindOrderDto
  ) {
    // Если переданы параметры фильтрации/пагинации - используем новый метод
    if (query.search || query.page || query.limit || query.sortBy || query.sortOrder || 
        query.acceptanceDateFrom || query.acceptanceDateTo || 
        query.exportDateFrom || query.exportDateTo || 
        query.shipmentDateFrom || query.shipmentDateTo) {
      return this.orderService.findAllWithPagination(query, userId, userRole)
    }
    // Для обратной совместимости - старый метод
    return this.orderService.findAll(userId, userRole, query.clientTIN)
  }

  @Get(':id')
  @Roles('ADMIN')
  async findOne(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.orderService.findOne(id, userId, userRole)
  }

  @Post()
  @Roles('ADMIN')
  @UsePipes(new ValidationPipe())
  async create(@Body() dto: OrderDto, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.orderService.create(dto, userId, userRole)
  }

  @Put(':id')
  @Roles('ADMIN')
  @UsePipes(new ValidationPipe())
  async update(@Param('id') id: string, @Body() dto: UpdateOrderDto, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.orderService.update(id, dto, userId, userRole)
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.orderService.remove(id, userId, userRole)
  }
}


import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, UsePipes, ValidationPipe, Query, UseInterceptors } from '@nestjs/common'
import { OrderService } from './order.service'
import { OrderDto, UpdateOrderDto, FindOrderDto } from './order.dto'
import { JwtAuthGuard } from '../auth/guards/jwt.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/user.decorator'
import { Auth } from '../auth/decorators/auth.decorator'
import { OrderDateInterceptor } from './order-date.interceptor'

@Controller('orders')
@UseInterceptors(OrderDateInterceptor)
export class UserOrderController {
  constructor(private readonly orderService: OrderService) {}

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
    @Query() query: FindOrderDto
  ) {
    // Всегда используем пагинацию по умолчанию для предотвращения таймаутов
    const page = query.page || 1
    const limit = query.limit || 20
    
    return this.orderService.findAllWithPagination(
      { ...query, page, limit },
      userId,
      userRole
    )
  }

  @Get('meta/last-import')
  @Auth()
  async getLastImportInfo() {
    return this.orderService.getLastImportInfo()
  }

  @Get(':id')
  @Auth()
  async findOne(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.orderService.findOne(id, userId, userRole)
  }
}

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(OrderDateInterceptor)
export class AdminOrderController {
  constructor(private readonly orderService: OrderService) {}

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
    @Query() query: FindOrderDto
  ) {
    // Всегда используем пагинацию по умолчанию для предотвращения таймаутов
    const page = query.page || 1
    const limit = query.limit || 20
    
    return this.orderService.findAllWithPagination(
      { ...query, page, limit },
      userId,
      userRole
    )
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


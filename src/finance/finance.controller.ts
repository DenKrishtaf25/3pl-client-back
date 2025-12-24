import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, UsePipes, ValidationPipe, Query } from '@nestjs/common'
import { FinanceService } from './finance.service'
import { FinanceDto, UpdateFinanceDto, FindFinanceDto, FinanceStatusStatsDto } from './finance.dto'
import { JwtAuthGuard } from '../auth/guards/jwt.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/user.decorator'
import { Auth } from '../auth/decorators/auth.decorator'

@Controller('finance')
export class UserFinanceController {
  constructor(private readonly financeService: FinanceService) {}

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
    @Query() query: FindFinanceDto
  ) {
    // Если переданы параметры фильтрации/пагинации - используем новый метод
    if (query.search || query.page || query.limit || query.sortBy || query.sortOrder || 
        query.dateFrom || query.dateTo || 
        query.completionDateFrom || query.completionDateTo ||
        query.closingDateFrom || query.closingDateTo ||
        query.amountFrom !== undefined || query.amountTo !== undefined) {
      return this.financeService.findAllWithPagination(query, userId, userRole)
    }
    // Для обратной совместимости - старый метод
    return this.financeService.findAll(userId, userRole, query.clientTIN)
  }

  @Get('meta/last-import')
  @Auth()
  async getLastImportInfo() {
    return this.financeService.getLastImportInfo()
  }

  @Get('stats/status')
  @Auth()
  @UsePipes(new ValidationPipe({ 
    transform: true, 
    whitelist: true,
    forbidNonWhitelisted: false,
    skipMissingProperties: false,
    transformOptions: {
      enableImplicitConversion: true,
    }
  }))
  async getStatusStats(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Query() query: FinanceStatusStatsDto
  ) {
    return this.financeService.getStatusStats(query, userId, userRole)
  }

  @Get(':id')
  @Auth()
  async findOne(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.financeService.findOne(id, userId, userRole)
  }
}

@Controller('admin/finance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminFinanceController {
  constructor(private readonly financeService: FinanceService) {}

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
    @Query() query: FindFinanceDto
  ) {
    // Если переданы параметры фильтрации/пагинации - используем новый метод
    if (query.search || query.page || query.limit || query.sortBy || query.sortOrder || 
        query.dateFrom || query.dateTo || 
        query.completionDateFrom || query.completionDateTo ||
        query.closingDateFrom || query.closingDateTo ||
        query.amountFrom !== undefined || query.amountTo !== undefined) {
      return this.financeService.findAllWithPagination(query, userId, userRole)
    }
    // Для обратной совместимости - старый метод
    return this.financeService.findAll(userId, userRole, query.clientTIN)
  }

  @Get(':id')
  @Roles('ADMIN')
  async findOne(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.financeService.findOne(id, userId, userRole)
  }

  @Post()
  @Roles('ADMIN')
  @UsePipes(new ValidationPipe())
  async create(@Body() dto: FinanceDto, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.financeService.create(dto, userId, userRole)
  }

  @Put(':id')
  @Roles('ADMIN')
  @UsePipes(new ValidationPipe())
  async update(@Param('id') id: string, @Body() dto: UpdateFinanceDto, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.financeService.update(id, dto, userId, userRole)
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.financeService.remove(id, userId, userRole)
  }
}


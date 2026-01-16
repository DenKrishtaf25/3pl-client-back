import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, UsePipes, ValidationPipe, Query, HttpCode } from '@nestjs/common'
import { ComplaintsService } from './complaints.service'
import { ComplaintDto, UpdateComplaintDto, FindComplaintDto, SendComplaintEmailDto } from './complaints.dto'
import { JwtAuthGuard } from '../auth/guards/jwt.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/user.decorator'
import { Auth } from '../auth/decorators/auth.decorator'
import { EmailService } from '../email/email.service'

@Controller('complaints')
export class UserComplaintsController {
  constructor(
    private readonly complaintsService: ComplaintsService,
    private readonly emailService: EmailService
  ) {}

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
    @Query() query: FindComplaintDto
  ) {
    // Если переданы параметры фильтрации/пагинации - используем новый метод
    if (query.search || query.page || query.limit || query.sortBy || query.sortOrder || 
        query.dateFrom || query.dateTo || 
        query.deadlineFrom || query.deadlineTo ||
        query.completionDateFrom || query.completionDateTo ||
        query.confirmation !== undefined) {
      return this.complaintsService.findAllWithPagination(query, userId, userRole)
    }
    // Для обратной совместимости - старый метод
    return this.complaintsService.findAll(userId, userRole, query.clientTIN)
  }

  @Get('meta/last-import')
  @Auth()
  async getLastImportInfo() {
    return this.complaintsService.getLastImportInfo()
  }

  @Get('stats/status')
  @Auth()
  async getStatusStats(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string
  ) {
    return this.complaintsService.getStatusStats(userId, userRole)
  }

  @Get('stats/type')
  @Auth()
  async getTypeStats(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string
  ) {
    return this.complaintsService.getTypeStats(userId, userRole)
  }

  @Post('send-email')
  @Auth()
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async sendEmail(@Body() dto: SendComplaintEmailDto) {
    await this.emailService.sendComplaintEmail(dto.subject, dto.data)
    return { success: true, message: 'Email sent successfully' }
  }

  @Get(':id')
  @Auth()
  async findOne(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.complaintsService.findOne(id, userId, userRole)
  }
}

@Controller('admin/complaints')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminComplaintsController {
  constructor(private readonly complaintsService: ComplaintsService) {}

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
    @Query() query: FindComplaintDto
  ) {
    // Если переданы параметры фильтрации/пагинации - используем новый метод
    if (query.search || query.page || query.limit || query.sortBy || query.sortOrder || 
        query.dateFrom || query.dateTo || 
        query.deadlineFrom || query.deadlineTo ||
        query.completionDateFrom || query.completionDateTo ||
        query.confirmation !== undefined) {
      return this.complaintsService.findAllWithPagination(query, userId, userRole)
    }
    // Для обратной совместимости - старый метод
    return this.complaintsService.findAll(userId, userRole, query.clientTIN)
  }

  @Get(':id')
  @Roles('ADMIN')
  async findOne(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.complaintsService.findOne(id, userId, userRole)
  }

  @Post()
  @Roles('ADMIN')
  @UsePipes(new ValidationPipe())
  async create(@Body() dto: ComplaintDto, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.complaintsService.create(dto, userId, userRole)
  }

  @Put(':id')
  @Roles('ADMIN')
  @UsePipes(new ValidationPipe())
  async update(@Param('id') id: string, @Body() dto: UpdateComplaintDto, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.complaintsService.update(id, dto, userId, userRole)
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') userRole: string) {
    return this.complaintsService.remove(id, userId, userRole)
  }
}


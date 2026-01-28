import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, UsePipes, ValidationPipe, Query, HttpCode, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { extname } from 'path'
import * as fs from 'fs'
import { ComplaintsService } from './complaints.service'
import { ComplaintDto, UpdateComplaintDto, FindComplaintDto, SendComplaintEmailDto, SendComplaintEmailMultipartDto } from './complaints.dto'
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
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadDir = './uploads/complaints'
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true })
          }
          cb(null, uploadDir)
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
          const ext = extname(file.originalname)
          cb(null, `complaint-${uniqueSuffix}${ext}`)
        },
      }),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10 МБ
      },
      fileFilter: (req, file, cb) => {
        // Принимаем любые типы файлов
        cb(null, true)
      },
    })
  )
  async sendEmail(
    @Body() dto: any,
    @UploadedFile() file?: Express.Multer.File | undefined
  ) {
    // Проверяем, это multipart/form-data или JSON
    // Для multipart/form-data поля приходят как строки, для JSON - как объекты
    const isMultipart = dto && typeof dto === 'object' && ('to' in dto || 'firstName' in dto || 'lastName' in dto)
    
    if (isMultipart) {
      // Обработка multipart/form-data
      // Валидация полей
      if (!dto.to || !dto.subject) {
        throw new BadRequestException('Поля to и subject обязательны')
      }
      
      // Формируем объект данных из полей формы
      const data: Record<string, any> = {}
      if (dto.firstName) data.firstName = dto.firstName
      if (dto.lastName) data.lastName = dto.lastName
      if (dto.email) data.email = dto.email
      if (dto.phone) data.phone = dto.phone
      if (dto.position) data.position = dto.position
      if (dto.description) data.description = dto.description
      
      // Подготавливаем путь к файлу, если он есть
      let filePath: string | undefined
      if (file) {
        filePath = file.path
      }
      
      try {
        await this.emailService.sendComplaintEmail(
          dto.subject,
          data,
          dto.to,
          filePath,
          file?.originalname // Передаем оригинальное имя файла
        )
        // Удаляем файл после успешной отправки
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
      } catch (error) {
        // В случае ошибки также удаляем файл, чтобы не накапливать
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
        throw error
      }
    } else {
      // Обработка JSON (старый формат)
      const jsonDto = dto as SendComplaintEmailDto
      if (!jsonDto.subject || !jsonDto.data) {
        throw new BadRequestException('Поля subject и data обязательны')
      }
      await this.emailService.sendComplaintEmail(jsonDto.subject, jsonDto.data)
    }
    
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


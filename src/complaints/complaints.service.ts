import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { ComplaintDto, UpdateComplaintDto, FindComplaintDto, ComplaintStatusStatsDto } from './complaints.dto'
import { Prisma } from '@prisma/client'

@Injectable()
export class ComplaintsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getUserClientTINs(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { clients: { select: { TIN: true } } }
    })

    return user?.clients?.map(client => client.TIN) || []
  }

  async findAll(userId: string, userRole: string, clientTINFilter?: string) {
    // Получаем список клиентов пользователя
    const userClientTINs = await this.getUserClientTINs(userId)

    // Парсим фильтр clientTIN (может быть строка с запятыми или одно значение)
    let requestedTINs: string[] = []
    if (clientTINFilter) {
      requestedTINs = clientTINFilter.split(',').map(tin => tin.trim()).filter(Boolean)
    }

    // Определяем финальный список TIN для фильтрации
    let finalTINs: string[] = []

    if (userRole === 'ADMIN') {
      // Админ может видеть любые Complaints
      if (requestedTINs.length > 0) {
        // Если указан фильтр - используем его
        finalTINs = requestedTINs
      } else {
        // Если фильтр не указан - показываем все
        return this.prisma.complaint.findMany({
          select: {
            id: true,
            branch: true,
            client: true,
            creationDate: true,
            complaintNumber: true,
            complaintType: true,
            status: true,
            confirmation: true,
            deadline: true,
            completionDate: true,
            clientTIN: true,
            createdAt: true,
            updatedAt: true,
            clientRelation: {
              select: {
                id: true,
                TIN: true,
                companyName: true,
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        })
      }
    } else {
      // Обычный пользователь
      if (userClientTINs.length === 0) {
        return []
      }

      if (requestedTINs.length > 0) {
        // Проверяем, что запрашиваемые TIN доступны пользователю
        const allowedTINs = requestedTINs.filter(tin => userClientTINs.includes(tin))
        
        if (allowedTINs.length === 0) {
          throw new ForbiddenException('Access denied to the requested clients')
        }
        
        finalTINs = allowedTINs
      } else {
        // Если фильтр не указан - показываем все Complaints клиентов пользователя
        finalTINs = userClientTINs
      }
    }

    return this.prisma.complaint.findMany({
      where: {
        clientTIN: {
          in: finalTINs
        }
      },
      select: {
        id: true,
        branch: true,
        client: true,
        creationDate: true,
        complaintNumber: true,
        complaintType: true,
        status: true,
        confirmation: true,
        deadline: true,
        completionDate: true,
        clientTIN: true,
        createdAt: true,
        updatedAt: true,
        clientRelation: {
          select: {
            id: true,
            TIN: true,
            companyName: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })
  }

  async findAllWithPagination(dto: FindComplaintDto, userId: string, userRole: string) {
    const page = dto.page || 1
    // Для экспорта разрешаем до 100000 записей, для обычных запросов максимум 50
    const requestedLimit = dto.limit || 20
    const limit = requestedLimit > 50 ? Math.min(requestedLimit, 100000) : Math.min(requestedLimit, 50)
    const skip = (page - 1) * limit

    // Получаем список клиентов пользователя
    const userClientTINs = await this.getUserClientTINs(userId)

    // Парсим фильтр clientTIN (может быть строка с запятыми или одно значение)
    let requestedTINs: string[] = []
    if (dto.clientTIN) {
      requestedTINs = dto.clientTIN.split(',').map(tin => tin.trim()).filter(Boolean)
    }

    // Определяем финальный список TIN для фильтрации
    let allowedTINs: string[] = []

    if (userRole === 'ADMIN') {
      // Админ может видеть любые Complaints
      allowedTINs = requestedTINs.length > 0 ? requestedTINs : [] // Пустой массив = все клиенты
    } else {
      // Обычный пользователь
      if (userClientTINs.length === 0) {
        return {
          data: [],
          meta: {
            total: 0,
            page,
            limit,
            totalPages: 0,
          }
        }
      }

      if (requestedTINs.length > 0) {
        // Проверяем, что запрашиваемые TIN доступны пользователю
        const filteredTINs = requestedTINs.filter(tin => userClientTINs.includes(tin))
        
        if (filteredTINs.length === 0) {
          throw new ForbiddenException('Access denied to the requested clients')
        }
        
        allowedTINs = filteredTINs
      } else {
        // Если фильтр не указан - показываем все Complaints клиентов пользователя
        allowedTINs = userClientTINs
      }
    }

    // Формируем условия поиска
    const where: Prisma.ComplaintWhereInput = {}
    
    // Фильтр по клиентам
    if (allowedTINs.length > 0) {
      where.clientTIN = { in: allowedTINs }
    } else if (userRole !== 'ADMIN') {
      // Для не-админа без клиентов - пустой результат
      return {
        data: [],
        meta: {
          total: 0,
          page,
          limit,
          totalPages: 0,
        }
      }
    }

    // Отдельные фильтры по полям
    if (dto.branch) {
      const branchTerm = dto.branch.trim()
      if (branchTerm) {
        where.branch = { contains: branchTerm, mode: 'insensitive' }
      }
    }

    if (dto.client) {
      const clientTerm = dto.client.trim()
      if (clientTerm) {
        where.client = { contains: clientTerm, mode: 'insensitive' }
      }
    }

    if (dto.complaintNumber) {
      const complaintNumberTerm = dto.complaintNumber.trim()
      if (complaintNumberTerm) {
        where.complaintNumber = { contains: complaintNumberTerm, mode: 'insensitive' }
      }
    }

    if (dto.complaintType) {
      const complaintTypeTerm = dto.complaintType.trim()
      if (complaintTypeTerm) {
        where.complaintType = { contains: complaintTypeTerm, mode: 'insensitive' }
      }
    }

    if (dto.status) {
      const statusTerm = dto.status.trim()
      if (statusTerm) {
        where.status = { contains: statusTerm, mode: 'insensitive' }
      }
    }

    if (dto.confirmation !== undefined) {
      where.confirmation = dto.confirmation
    }

    // Общий поиск (если указан, работает вместе с отдельными фильтрами)
    if (dto.search) {
      const searchTerm = dto.search.trim()
      if (searchTerm) {
        // Если уже есть фильтры по отдельным полям, добавляем OR условие
        // Иначе используем OR для поиска по всем полям
        if (!dto.branch && !dto.client && !dto.complaintNumber && !dto.status && !dto.complaintType) {
          where.OR = [
            { branch: { contains: searchTerm, mode: 'insensitive' } },
            { client: { contains: searchTerm, mode: 'insensitive' } },
            { complaintNumber: { contains: searchTerm, mode: 'insensitive' } },
            { complaintType: { contains: searchTerm, mode: 'insensitive' } },
            { status: { contains: searchTerm, mode: 'insensitive' } },
          ]
        }
        // Если есть отдельные фильтры, search игнорируется (приоритет у отдельных фильтров)
      }
    }

    // Вспомогательная функция для парсинга даты с временем
    const parseDateTime = (dateStr: string | undefined, isEndOfDay: boolean = false): Date | undefined => {
      if (!dateStr) return undefined
      
      const trimmed = dateStr.trim()
      if (!trimmed) return undefined
      
      // Если дата содержит время
      if (trimmed.includes('T') || trimmed.includes(' ')) {
        // Если уже есть Z или часовой пояс, используем как есть
        if (trimmed.includes('Z') || trimmed.match(/[+-]\d{2}:\d{2}$/)) {
          const date = new Date(trimmed)
          if (!isNaN(date.getTime())) {
            return date
          }
        } else {
          // Если нет часового пояса, добавляем Z (интерпретируем как UTC)
          const dateStrWithZ = trimmed.endsWith('Z') ? trimmed : trimmed + 'Z'
          const date = new Date(dateStrWithZ)
          if (!isNaN(date.getTime())) {
            return date
          }
        }
      }
      
      // Если только дата, добавляем время
      const dateOnly = trimmed.split('T')[0].split(' ')[0]
      if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
        if (isEndOfDay) {
          return new Date(dateOnly + 'T23:59:59.999Z')
        } else {
          return new Date(dateOnly + 'T00:00:00.000Z')
        }
      }
      
      return undefined
    }

    // Фильтрация по дате создания
    if (dto.dateFrom || dto.dateTo) {
      const dateFilter: { gte?: Date; lte?: Date } = {}
      
      if (dto.dateFrom) {
        const fromDate = parseDateTime(dto.dateFrom, false)
        if (fromDate) {
          dateFilter.gte = fromDate
        }
      }
      
      if (dto.dateTo) {
        const toDate = parseDateTime(dto.dateTo, true)
        if (toDate) {
          dateFilter.lte = toDate
        }
      }
      
      if (dateFilter.gte || dateFilter.lte) {
        where.creationDate = dateFilter
      }
    }

    // Фильтрация по крайнему сроку
    if (dto.deadlineFrom || dto.deadlineTo) {
      const deadlineFilter: { gte?: Date; lte?: Date } = {}
      
      if (dto.deadlineFrom) {
        const fromDate = parseDateTime(dto.deadlineFrom, false)
        if (fromDate) {
          deadlineFilter.gte = fromDate
        }
      }
      
      if (dto.deadlineTo) {
        const toDate = parseDateTime(dto.deadlineTo, true)
        if (toDate) {
          deadlineFilter.lte = toDate
        }
      }
      
      if (deadlineFilter.gte || deadlineFilter.lte) {
        where.deadline = deadlineFilter
      }
    }

    // Фильтрация по дате завершения
    if (dto.completionDateFrom || dto.completionDateTo) {
      const completionDateFilter: { gte?: Date; lte?: Date } = {}
      
      if (dto.completionDateFrom) {
        const fromDate = parseDateTime(dto.completionDateFrom, false)
        if (fromDate) {
          completionDateFilter.gte = fromDate
        }
      }
      
      if (dto.completionDateTo) {
        const toDate = parseDateTime(dto.completionDateTo, true)
        if (toDate) {
          completionDateFilter.lte = toDate
        }
      }
      
      if (completionDateFilter.gte || completionDateFilter.lte) {
        where.completionDate = completionDateFilter
      }
    }

    // Формируем сортировку
    const orderBy: Prisma.ComplaintOrderByWithRelationInput = {}
    if (dto.sortBy === 'creationDate') {
      orderBy.creationDate = dto.sortOrder || 'desc'
    } else if (dto.sortBy === 'status') {
      orderBy.status = dto.sortOrder || 'asc'
    } else if (dto.sortBy === 'deadline') {
      orderBy.deadline = dto.sortOrder || 'desc'
    } else if (dto.sortBy === 'completionDate') {
      orderBy.completionDate = dto.sortOrder || 'desc'
    } else {
      orderBy.complaintNumber = dto.sortOrder || 'asc'
    }

    // Получаем общее количество записей (для пагинации)
    const total = await this.prisma.complaint.count({ where })

    // Получаем данные
    const complaints = await this.prisma.complaint.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      select: {
        id: true,
        branch: true,
        client: true,
        creationDate: true,
        complaintNumber: true,
        complaintType: true,
        status: true,
        confirmation: true,
        deadline: true,
        completionDate: true,
        clientTIN: true,
        createdAt: true,
        updatedAt: true,
        clientRelation: {
          select: {
            id: true,
            TIN: true,
            companyName: true,
          }
        }
      }
    })

    return {
      data: complaints,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
    }
  }

  async findOne(id: string, userId: string, userRole: string) {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id },
      select: {
        id: true,
        branch: true,
        client: true,
        creationDate: true,
        complaintNumber: true,
        complaintType: true,
        status: true,
        confirmation: true,
        deadline: true,
        completionDate: true,
        clientTIN: true,
        createdAt: true,
        updatedAt: true,
        clientRelation: {
          select: {
            id: true,
            TIN: true,
            companyName: true,
          }
        }
      }
    })

    if (!complaint) {
      throw new NotFoundException('Complaint not found')
    }

    // Админ может видеть все Complaints
    if (userRole === 'ADMIN') {
      return complaint
    }

    // Обычный пользователь может видеть только Complaints своих клиентов
    const clientTINs = await this.getUserClientTINs(userId)

    if (clientTINs.length === 0 || !clientTINs.includes(complaint.clientTIN)) {
      throw new ForbiddenException('Access denied to this complaint')
    }

    return complaint
  }

  async create(dto: ComplaintDto, userId: string, userRole: string) {
    // Админ может создавать Complaints для любого клиента
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(dto.clientTIN)) {
        throw new ForbiddenException('Access denied to create complaint for this client')
      }
    }

    // Проверяем существование клиента
    const client = await this.prisma.client.findUnique({
      where: { TIN: dto.clientTIN }
    })

    if (!client) {
      throw new NotFoundException('Client with this TIN not found')
    }

    return this.prisma.complaint.create({
      data: {
        branch: dto.branch,
        client: dto.client,
        creationDate: new Date(dto.creationDate),
        complaintNumber: dto.complaintNumber,
        complaintType: dto.complaintType,
        status: dto.status,
        confirmation: dto.confirmation,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        completionDate: dto.completionDate ? new Date(dto.completionDate) : null,
        clientTIN: dto.clientTIN
      },
      include: { clientRelation: true }
    })
  }

  async update(id: string, dto: UpdateComplaintDto, userId: string, userRole: string) {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id }
    })

    if (!complaint) {
      throw new NotFoundException('Complaint not found')
    }

    // Админ может обновлять любой Complaint
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(complaint.clientTIN)) {
        throw new ForbiddenException('Access denied to update this complaint')
      }

      // Если пытаются изменить clientTIN, проверяем доступ к новому клиенту
      if (dto.clientTIN && dto.clientTIN !== complaint.clientTIN) {
        if (!clientTINs.includes(dto.clientTIN)) {
          throw new ForbiddenException('Access denied to assign complaint to this client')
        }
      }
    }

    // Если пытаются изменить clientTIN, проверяем существование нового клиента
    if (dto.clientTIN && dto.clientTIN !== complaint.clientTIN) {
      const newClient = await this.prisma.client.findUnique({
        where: { TIN: dto.clientTIN }
      })

      if (!newClient) {
        throw new NotFoundException('Client with this TIN not found')
      }
    }

    return this.prisma.complaint.update({
      where: { id },
      data: {
        ...(dto.branch && { branch: dto.branch }),
        ...(dto.client && { client: dto.client }),
        ...(dto.creationDate && { creationDate: new Date(dto.creationDate) }),
        ...(dto.complaintNumber && { complaintNumber: dto.complaintNumber }),
        ...(dto.complaintType && { complaintType: dto.complaintType }),
        ...(dto.status && { status: dto.status }),
        ...(dto.confirmation !== undefined && { confirmation: dto.confirmation }),
        ...(dto.deadline !== undefined && { deadline: dto.deadline ? new Date(dto.deadline) : null }),
        ...(dto.completionDate !== undefined && { completionDate: dto.completionDate ? new Date(dto.completionDate) : null }),
        ...(dto.clientTIN && { clientTIN: dto.clientTIN })
      },
      include: { clientRelation: true }
    })
  }

  async remove(id: string, userId: string, userRole: string) {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id }
    })

    if (!complaint) {
      throw new NotFoundException('Complaint not found')
    }

    // Админ может удалять любой Complaint
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(complaint.clientTIN)) {
        throw new ForbiddenException('Access denied to delete this complaint')
      }
    }

    return this.prisma.complaint.delete({
      where: { id },
      include: { clientRelation: true }
    })
  }

  async getLastImportInfo() {
    const metadata = await this.prisma.importMetadata.findUnique({
      where: { importType: 'complaints' }
    })

    if (!metadata) {
      return {
        lastImportAt: null,
        recordsImported: 0,
        recordsUpdated: 0,
        recordsDeleted: 0,
        recordsSkipped: 0,
        errors: 0,
      }
    }

    return {
      lastImportAt: metadata.lastImportAt,
      recordsImported: metadata.recordsImported,
      recordsUpdated: metadata.recordsUpdated,
      recordsDeleted: metadata.recordsDeleted,
      recordsSkipped: metadata.recordsSkipped,
      errors: metadata.errors,
    }
  }

  async getStatusStats(userId: string, userRole: string) {
    // Получаем список клиентов пользователя
    const userClientTINs = await this.getUserClientTINs(userId)

    // Определяем финальный список TIN для фильтрации
    let allowedTINs: string[] = []

    if (userRole === 'ADMIN') {
      // Админ может видеть все Complaints
      allowedTINs = [] // Пустой массив = все клиенты
    } else {
      // Обычный пользователь
      if (userClientTINs.length === 0) {
        return []
      }
      allowedTINs = userClientTINs
    }

    // Формируем условие для фильтрации по клиентам
    const where: Prisma.ComplaintWhereInput = {}
    if (allowedTINs.length > 0) {
      where.clientTIN = { in: allowedTINs }
    }

    // Получаем все записи Complaints с нужными полями
    const complaints = await this.prisma.complaint.findMany({
      where,
      select: {
        status: true,
        confirmation: true,
      }
    })

    // Группируем по статусам
    const statusMap = new Map<string, { count: number; confirmedCount: number; unconfirmedCount: number }>()

    complaints.forEach(complaint => {
      const status = complaint.status || 'Без статуса'
      const confirmation = complaint.confirmation ?? false

      if (statusMap.has(status)) {
        const existing = statusMap.get(status)!
        statusMap.set(status, {
          count: existing.count + 1,
          confirmedCount: existing.confirmedCount + (confirmation ? 1 : 0),
          unconfirmedCount: existing.unconfirmedCount + (confirmation ? 0 : 1),
        })
      } else {
        statusMap.set(status, {
          count: 1,
          confirmedCount: confirmation ? 1 : 0,
          unconfirmedCount: confirmation ? 0 : 1,
        })
      }
    })

    // Преобразуем в массив (без сортировки)
    const stats = Array.from(statusMap.entries()).map(([status, data]) => ({
      status,
      count: data.count,
      confirmedCount: data.confirmedCount,
      unconfirmedCount: data.unconfirmedCount,
    }))

    return stats
  }
}


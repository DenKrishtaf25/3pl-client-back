import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { FinanceDto, UpdateFinanceDto, FindFinanceDto, FinanceStatusStatsDto } from './finance.dto'
import { Prisma } from '@prisma/client'

@Injectable()
export class FinanceService {
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
      // Админ может видеть любые Finance
      if (requestedTINs.length > 0) {
        // Если указан фильтр - используем его
        finalTINs = requestedTINs
      } else {
        // Если фильтр не указан - показываем все
        return this.prisma.finance.findMany({
          include: { client: true },
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
        // Если фильтр не указан - показываем все Finance клиентов пользователя
        finalTINs = userClientTINs
      }
    }

    return this.prisma.finance.findMany({
      where: {
        clientTIN: {
          in: finalTINs
        }
      },
      include: { client: true },
      orderBy: { createdAt: 'desc' }
    })
  }

  async findAllWithPagination(dto: FindFinanceDto, userId: string, userRole: string) {
    const page = dto.page || 1
    const limit = Math.min(dto.limit || 20, 50) // Максимум 50 записей
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
      // Админ может видеть любые Finance
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
        // Если фильтр не указан - показываем все Finance клиентов пользователя
        allowedTINs = userClientTINs
      }
    }

    // Формируем условия поиска
    const where: Prisma.FinanceWhereInput = {}
    
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

    if (dto.counterparty) {
      const counterpartyTerm = dto.counterparty.trim()
      if (counterpartyTerm) {
        where.counterparty = { contains: counterpartyTerm, mode: 'insensitive' }
      }
    }

    if (dto.orderNumber) {
      const orderNumberTerm = dto.orderNumber.trim()
      if (orderNumberTerm) {
        where.orderNumber = { contains: orderNumberTerm, mode: 'insensitive' }
      }
    }

    if (dto.status) {
      const statusTerm = dto.status.trim()
      if (statusTerm) {
        where.status = { contains: statusTerm, mode: 'insensitive' }
      }
    }

    // Общий поиск (если указан, работает вместе с отдельными фильтрами)
    if (dto.search) {
      const searchTerm = dto.search.trim()
      if (searchTerm) {
        // Если уже есть фильтры по отдельным полям, добавляем OR условие
        // Иначе используем OR для поиска по всем полям
        if (!dto.branch && !dto.counterparty && !dto.orderNumber && !dto.status) {
          where.OR = [
            { branch: { contains: searchTerm, mode: 'insensitive' } },
            { counterparty: { contains: searchTerm, mode: 'insensitive' } },
            { orderNumber: { contains: searchTerm, mode: 'insensitive' } },
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

    // Фильтрация по дате
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
        where.date = dateFilter
      }
    }

    // Фильтрация по сумме
    if (dto.amountFrom !== undefined || dto.amountTo !== undefined) {
      const amountFilter: { gte?: number; lte?: number } = {}
      
      if (dto.amountFrom !== undefined) {
        amountFilter.gte = dto.amountFrom
      }
      
      if (dto.amountTo !== undefined) {
        amountFilter.lte = dto.amountTo
      }
      
      if (amountFilter.gte !== undefined || amountFilter.lte !== undefined) {
        where.amount = amountFilter
      }
    }

    // Формируем сортировку
    const orderBy: Prisma.FinanceOrderByWithRelationInput = {}
    if (dto.sortBy === 'date') {
      orderBy.date = dto.sortOrder || 'desc'
    } else if (dto.sortBy === 'amount') {
      orderBy.amount = dto.sortOrder || 'desc'
    } else {
      orderBy.orderNumber = dto.sortOrder || 'asc'
    }

    // Получаем общее количество записей (для пагинации)
    const total = await this.prisma.finance.count({ where })

    // Получаем данные
    const finances = await this.prisma.finance.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      select: {
        id: true,
        branch: true,
        counterparty: true,
        date: true,
        orderNumber: true,
        amount: true,
        status: true,
        comment: true,
        clientTIN: true,
        createdAt: true,
        updatedAt: true,
        client: {
          select: {
            id: true,
            TIN: true,
            companyName: true,
          }
        }
      }
    })

    return {
      data: finances,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
    }
  }

  async findOne(id: string, userId: string, userRole: string) {
    const finance = await this.prisma.finance.findUnique({
      where: { id },
      include: { client: true }
    })

    if (!finance) {
      throw new NotFoundException('Finance not found')
    }

    // Админ может видеть все Finance
    if (userRole === 'ADMIN') {
      return finance
    }

    // Обычный пользователь может видеть только Finance своих клиентов
    const clientTINs = await this.getUserClientTINs(userId)

    if (clientTINs.length === 0 || !clientTINs.includes(finance.clientTIN)) {
      throw new ForbiddenException('Access denied to this finance')
    }

    return finance
  }

  async create(dto: FinanceDto, userId: string, userRole: string) {
    // Админ может создавать Finance для любого клиента
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(dto.clientTIN)) {
        throw new ForbiddenException('Access denied to create finance for this client')
      }
    }

    // Проверяем существование клиента
    const client = await this.prisma.client.findUnique({
      where: { TIN: dto.clientTIN }
    })

    if (!client) {
      throw new NotFoundException('Client with this TIN not found')
    }

    return this.prisma.finance.create({
      data: {
        branch: dto.branch,
        counterparty: dto.counterparty,
        date: new Date(dto.date),
        orderNumber: dto.orderNumber,
        amount: dto.amount,
        status: dto.status,
        comment: dto.comment,
        clientTIN: dto.clientTIN
      },
      include: { client: true }
    })
  }

  async update(id: string, dto: UpdateFinanceDto, userId: string, userRole: string) {
    const finance = await this.prisma.finance.findUnique({
      where: { id }
    })

    if (!finance) {
      throw new NotFoundException('Finance not found')
    }

    // Админ может обновлять любой Finance
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(finance.clientTIN)) {
        throw new ForbiddenException('Access denied to update this finance')
      }

      // Если пытаются изменить clientTIN, проверяем доступ к новому клиенту
      if (dto.clientTIN && dto.clientTIN !== finance.clientTIN) {
        if (!clientTINs.includes(dto.clientTIN)) {
          throw new ForbiddenException('Access denied to assign finance to this client')
        }
      }
    }

    // Если пытаются изменить clientTIN, проверяем существование нового клиента
    if (dto.clientTIN && dto.clientTIN !== finance.clientTIN) {
      const newClient = await this.prisma.client.findUnique({
        where: { TIN: dto.clientTIN }
      })

      if (!newClient) {
        throw new NotFoundException('Client with this TIN not found')
      }
    }

    return this.prisma.finance.update({
      where: { id },
      data: {
        ...(dto.branch && { branch: dto.branch }),
        ...(dto.counterparty && { counterparty: dto.counterparty }),
        ...(dto.date && { date: new Date(dto.date) }),
        ...(dto.orderNumber && { orderNumber: dto.orderNumber }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.status && { status: dto.status }),
        ...(dto.comment !== undefined && { comment: dto.comment }),
        ...(dto.clientTIN && { clientTIN: dto.clientTIN })
      },
      include: { client: true }
    })
  }

  async remove(id: string, userId: string, userRole: string) {
    const finance = await this.prisma.finance.findUnique({
      where: { id }
    })

    if (!finance) {
      throw new NotFoundException('Finance not found')
    }

    // Админ может удалять любой Finance
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(finance.clientTIN)) {
        throw new ForbiddenException('Access denied to delete this finance')
      }
    }

    return this.prisma.finance.delete({
      where: { id },
      include: { client: true }
    })
  }

  async getLastImportInfo() {
    const metadata = await this.prisma.importMetadata.findUnique({
      where: { importType: 'finance' }
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

  async getStatusStats(dto: FinanceStatusStatsDto, userId: string, userRole: string) {
    // Получаем список клиентов пользователя
    const userClientTINs = await this.getUserClientTINs(userId)

    // Определяем финальный список TIN для фильтрации
    let allowedTINs: string[] = []

    if (userRole === 'ADMIN') {
      // Админ может видеть все Finance
      allowedTINs = [] // Пустой массив = все клиенты
    } else {
      // Обычный пользователь
      if (userClientTINs.length === 0) {
        return []
      }
      allowedTINs = userClientTINs
    }

    // Формируем условие для фильтрации по клиентам
    const where: Prisma.FinanceWhereInput = {}
    if (allowedTINs.length > 0) {
      where.clientTIN = { in: allowedTINs }
    }

    // Получаем все записи Finance с нужными полями
    const finances = await this.prisma.finance.findMany({
      where,
      select: {
        status: true,
        amount: true,
      }
    })

    // Группируем по статусам
    const statusMap = new Map<string, { amount: number; count: number }>()

    finances.forEach(finance => {
      const status = finance.status || 'Без статуса'
      const amount = Number(finance.amount) || 0

      if (statusMap.has(status)) {
        const existing = statusMap.get(status)!
        statusMap.set(status, {
          amount: existing.amount + amount,
          count: existing.count + 1,
        })
      } else {
        statusMap.set(status, {
          amount,
          count: 1,
        })
      }
    })

    // Преобразуем в массив
    const stats = Array.from(statusMap.entries()).map(([status, data]) => ({
      status,
      amount: data.amount,
      count: data.count,
    }))

    // Сортировка
    const sortBy = dto.sortBy || 'amount'
    const sortOrder = dto.sortOrder || 'desc'

    stats.sort((a, b) => {
      let comparison = 0
      if (sortBy === 'amount') {
        comparison = a.amount - b.amount
      } else if (sortBy === 'count') {
        comparison = a.count - b.count
      }

      return sortOrder === 'asc' ? comparison : -comparison
    })

    return stats
  }
}


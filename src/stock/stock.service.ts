import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { StockDto, UpdateStockDto, FindStockDto } from './stock.dto'
import { Prisma } from '@prisma/client'

@Injectable()
export class StockService {
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
      // Админ может видеть любые Stock
      if (requestedTINs.length > 0) {
        // Если указан фильтр - используем его
        finalTINs = requestedTINs
      } else {
        // Если фильтр не указан - показываем все, но с лимитом для безопасности
        const MAX_RECORDS = 1000
        return this.prisma.stock.findMany({
          include: { client: true },
          orderBy: { createdAt: 'desc' },
          take: MAX_RECORDS
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
        // Если фильтр не указан - показываем все Stock клиентов пользователя
        finalTINs = userClientTINs
      }
    }

    // Добавляем лимит для безопасности даже в старом методе
    const MAX_RECORDS = 1000
    return this.prisma.stock.findMany({
      where: {
        clientTIN: {
          in: finalTINs
        }
      },
      include: { client: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_RECORDS
    })
  }

  async findAllWithPagination(dto: FindStockDto, userId: string, userRole: string) {
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
      // Админ может видеть любые Stock
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
        // Если фильтр не указан - показываем все Stock клиентов пользователя
        allowedTINs = userClientTINs
      }
    }

    // Формируем условия поиска
    const where: Prisma.StockWhereInput = {}
    
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

    // Отдельные фильтры по Складу, Номенклатуре и Артикулу
    if (dto.warehouse) {
      const warehouseTerm = dto.warehouse.trim()
      if (warehouseTerm) {
        where.warehouse = { contains: warehouseTerm, mode: 'insensitive' }
      }
    }

    if (dto.nomenclature) {
      const nomenclatureTerm = dto.nomenclature.trim()
      if (nomenclatureTerm) {
        where.nomenclature = { contains: nomenclatureTerm, mode: 'insensitive' }
      }
    }

    if (dto.article) {
      const articleTerm = dto.article.trim()
      if (articleTerm) {
        where.article = { contains: articleTerm, mode: 'insensitive' }
      }
    }

    if (dto.counterparty) {
      const counterpartyTerm = dto.counterparty.trim()
      if (counterpartyTerm) {
        where.counterparty = { contains: counterpartyTerm, mode: 'insensitive' }
      }
    }

    // Общий поиск (если указан, работает вместе с отдельными фильтрами)
    if (dto.search) {
      const searchTerm = dto.search.trim()
      if (searchTerm) {
        // Если уже есть фильтры по отдельным полям, добавляем OR условие
        // Иначе используем OR для поиска по всем полям
        if (!dto.warehouse && !dto.nomenclature && !dto.article && !dto.counterparty) {
          where.OR = [
            { warehouse: { contains: searchTerm, mode: 'insensitive' } },
            { nomenclature: { contains: searchTerm, mode: 'insensitive' } },
            { article: { contains: searchTerm, mode: 'insensitive' } },
            { counterparty: { contains: searchTerm, mode: 'insensitive' } },
          ]
        }
        // Если есть отдельные фильтры, search игнорируется (приоритет у отдельных фильтров)
      }
    }

    // Формируем сортировку
    const orderBy: Prisma.StockOrderByWithRelationInput = {}
    if (dto.sortBy === 'quantity') {
      orderBy.quantity = dto.sortOrder || 'asc'
    } else {
      orderBy.article = dto.sortOrder || 'asc'
    }

    // Получаем общее количество записей (для пагинации)
    const total = await this.prisma.stock.count({ where })

    // Получаем данные
    const stocks = await this.prisma.stock.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      select: {
        id: true,
        warehouse: true,
        nomenclature: true,
        article: true,
        quantity: true,
        counterparty: true,
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
      data: stocks,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
    }
  }

  async findOne(id: string, userId: string, userRole: string) {
    const stock = await this.prisma.stock.findUnique({
      where: { id },
      include: { client: true }
    })

    if (!stock) {
      throw new NotFoundException('Stock not found')
    }

    // Админ может видеть все Stock
    if (userRole === 'ADMIN') {
      return stock
    }

    // Обычный пользователь может видеть только Stock своих клиентов
    const clientTINs = await this.getUserClientTINs(userId)

    if (clientTINs.length === 0 || !clientTINs.includes(stock.clientTIN)) {
      throw new ForbiddenException('Access denied to this stock')
    }

    return stock
  }

  async create(dto: StockDto, userId: string, userRole: string) {
    // Админ может создавать Stock для любого клиента
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(dto.clientTIN)) {
        throw new ForbiddenException('Access denied to create stock for this client')
      }
    }

    // Проверяем существование клиента
    const client = await this.prisma.client.findUnique({
      where: { TIN: dto.clientTIN }
    })

    if (!client) {
      throw new NotFoundException('Client with this TIN not found')
    }

    return this.prisma.stock.create({
      data: {
        warehouse: dto.warehouse,
        nomenclature: dto.nomenclature,
        article: dto.article,
        quantity: dto.quantity,
        counterparty: dto.counterparty,
        clientTIN: dto.clientTIN
      },
      include: { client: true }
    })
  }

  async update(id: string, dto: UpdateStockDto, userId: string, userRole: string) {
    const stock = await this.prisma.stock.findUnique({
      where: { id }
    })

    if (!stock) {
      throw new NotFoundException('Stock not found')
    }

    // Админ может обновлять любой Stock
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(stock.clientTIN)) {
        throw new ForbiddenException('Access denied to update this stock')
      }

      // Если пытаются изменить clientTIN, проверяем доступ к новому клиенту
      if (dto.clientTIN && dto.clientTIN !== stock.clientTIN) {
        if (!clientTINs.includes(dto.clientTIN)) {
          throw new ForbiddenException('Access denied to assign stock to this client')
        }
      }
    }

    // Если пытаются изменить clientTIN, проверяем существование нового клиента
    if (dto.clientTIN && dto.clientTIN !== stock.clientTIN) {
      const newClient = await this.prisma.client.findUnique({
        where: { TIN: dto.clientTIN }
      })

      if (!newClient) {
        throw new NotFoundException('Client with this TIN not found')
      }
    }

    return this.prisma.stock.update({
      where: { id },
      data: {
        ...(dto.warehouse && { warehouse: dto.warehouse }),
        ...(dto.nomenclature && { nomenclature: dto.nomenclature }),
        ...(dto.article && { article: dto.article }),
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.counterparty && { counterparty: dto.counterparty }),
        ...(dto.clientTIN && { clientTIN: dto.clientTIN })
      },
      include: { client: true }
    })
  }

  async remove(id: string, userId: string, userRole: string) {
    const stock = await this.prisma.stock.findUnique({
      where: { id }
    })

    if (!stock) {
      throw new NotFoundException('Stock not found')
    }

    // Админ может удалять любой Stock
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(stock.clientTIN)) {
        throw new ForbiddenException('Access denied to delete this stock')
      }
    }

    return this.prisma.stock.delete({
      where: { id },
      include: { client: true }
    })
  }

  async getLastImportInfo() {
    const metadata = await this.prisma.importMetadata.findUnique({
      where: { importType: 'stock' }
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
}
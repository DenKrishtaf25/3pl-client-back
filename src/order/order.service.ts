import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { OrderDto, UpdateOrderDto, FindOrderDto } from './order.dto'
import { Prisma } from '@prisma/client'

@Injectable()
export class OrderService {
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
      // Админ может видеть любые Order
      if (requestedTINs.length > 0) {
        // Если указан фильтр - используем его
        finalTINs = requestedTINs
      } else {
        // Если фильтр не указан - показываем все
        return this.prisma.order.findMany({
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
        // Если фильтр не указан - показываем все Order клиентов пользователя
        finalTINs = userClientTINs
      }
    }

    return this.prisma.order.findMany({
      where: {
        clientTIN: {
          in: finalTINs
        }
      },
      include: { client: true },
      orderBy: { createdAt: 'desc' }
    })
  }

  async findAllWithPagination(dto: FindOrderDto, userId: string, userRole: string) {
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
      // Админ может видеть любые Order
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
        // Если фильтр не указан - показываем все Order клиентов пользователя
        allowedTINs = userClientTINs
      }
    }

    // Формируем условия поиска
    const where: Prisma.OrderWhereInput = {}
    
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

    // Поиск по филиалу и контрагенту
    if (dto.search) {
      const searchTerm = dto.search.trim()
      where.OR = [
        { branch: { contains: searchTerm, mode: 'insensitive' } },
        { counterparty: { contains: searchTerm, mode: 'insensitive' } },
      ]
    }

    // Фильтрация по дате
    if (dto.dateFrom || dto.dateTo) {
      // По умолчанию фильтруем по acceptanceDate (дата приемки/отгрузки), если не указано поле
      const dateField = dto.dateField || 'acceptanceDate'
      
      const dateFilter: { gte?: Date; lte?: Date } = {}
      
      if (dto.dateFrom) {
        const dateFromStr = dto.dateFrom.trim().split('T')[0]
        if (dateFromStr) {
          // Создаем дату как ISO строку в начале дня UTC
          dateFilter.gte = new Date(dateFromStr + 'T00:00:00.000Z')
        }
      }
      
      if (dto.dateTo) {
        const dateToStr = dto.dateTo.trim().split('T')[0]
        if (dateToStr) {
          // Создаем дату как ISO строку в конце дня UTC
          dateFilter.lte = new Date(dateToStr + 'T23:59:59.999Z')
        }
      }
      
      // Применяем фильтр к выбранному полю даты только если есть хотя бы одно условие
      if (dateFilter.gte || dateFilter.lte) {
        if (dateField === 'acceptanceDate') {
          where.acceptanceDate = dateFilter
        } else if (dateField === 'exportDate') {
          where.exportDate = dateFilter
        } else if (dateField === 'shipmentDate') {
          where.shipmentDate = dateFilter
        }
      }
    }

    // Формируем сортировку
    const orderBy: Prisma.OrderOrderByWithRelationInput = {}
    if (dto.sortBy === 'acceptanceDate') {
      orderBy.acceptanceDate = dto.sortOrder || 'desc'
    } else if (dto.sortBy === 'exportDate') {
      orderBy.exportDate = dto.sortOrder || 'desc'
    } else if (dto.sortBy === 'shipmentDate') {
      orderBy.shipmentDate = dto.sortOrder || 'desc'
    } else {
      orderBy.orderNumber = dto.sortOrder || 'asc'
    }

    // Получаем общее количество записей (для пагинации)
    const total = await this.prisma.order.count({ where })

    // Получаем данные
    const orders = await this.prisma.order.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      select: {
        id: true,
        branch: true,
        orderType: true,
        orderNumber: true,
        kisNumber: true,
        exportDate: true,
        shipmentDate: true,
        status: true,
        packagesPlanned: true,
        packagesActual: true,
        linesPlanned: true,
        linesActual: true,
        counterparty: true,
        acceptanceDate: true,
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
      data: orders,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
    }
  }

  async findOne(id: string, userId: string, userRole: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { client: true }
    })

    if (!order) {
      throw new NotFoundException('Order not found')
    }

    // Админ может видеть все Order
    if (userRole === 'ADMIN') {
      return order
    }

    // Обычный пользователь может видеть только Order своих клиентов
    const clientTINs = await this.getUserClientTINs(userId)

    if (clientTINs.length === 0 || !clientTINs.includes(order.clientTIN)) {
      throw new ForbiddenException('Access denied to this order')
    }

    return order
  }

  async create(dto: OrderDto, userId: string, userRole: string) {
    // Админ может создавать Order для любого клиента
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(dto.clientTIN)) {
        throw new ForbiddenException('Access denied to create order for this client')
      }
    }

    // Проверяем существование клиента
    const client = await this.prisma.client.findUnique({
      where: { TIN: dto.clientTIN }
    })

    if (!client) {
      throw new NotFoundException('Client with this TIN not found')
    }

    return this.prisma.order.create({
      data: {
        branch: dto.branch,
        orderType: dto.orderType,
        orderNumber: dto.orderNumber,
        kisNumber: dto.kisNumber,
        exportDate: new Date(dto.exportDate),
        shipmentDate: new Date(dto.shipmentDate),
        status: dto.status,
        packagesPlanned: dto.packagesPlanned,
        packagesActual: dto.packagesActual,
        linesPlanned: dto.linesPlanned,
        linesActual: dto.linesActual,
        counterparty: dto.counterparty,
        acceptanceDate: new Date(dto.acceptanceDate),
        clientTIN: dto.clientTIN
      },
      include: { client: true }
    })
  }

  async update(id: string, dto: UpdateOrderDto, userId: string, userRole: string) {
    const order = await this.prisma.order.findUnique({
      where: { id }
    })

    if (!order) {
      throw new NotFoundException('Order not found')
    }

    // Админ может обновлять любой Order
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(order.clientTIN)) {
        throw new ForbiddenException('Access denied to update this order')
      }

      // Если пытаются изменить clientTIN, проверяем доступ к новому клиенту
      if (dto.clientTIN && dto.clientTIN !== order.clientTIN) {
        if (!clientTINs.includes(dto.clientTIN)) {
          throw new ForbiddenException('Access denied to assign order to this client')
        }
      }
    }

    // Если пытаются изменить clientTIN, проверяем существование нового клиента
    if (dto.clientTIN && dto.clientTIN !== order.clientTIN) {
      const newClient = await this.prisma.client.findUnique({
        where: { TIN: dto.clientTIN }
      })

      if (!newClient) {
        throw new NotFoundException('Client with this TIN not found')
      }
    }

    return this.prisma.order.update({
      where: { id },
      data: {
        ...(dto.branch && { branch: dto.branch }),
        ...(dto.orderType && { orderType: dto.orderType }),
        ...(dto.orderNumber && { orderNumber: dto.orderNumber }),
        ...(dto.kisNumber && { kisNumber: dto.kisNumber }),
        ...(dto.exportDate && { exportDate: new Date(dto.exportDate) }),
        ...(dto.shipmentDate && { shipmentDate: new Date(dto.shipmentDate) }),
        ...(dto.status && { status: dto.status }),
        ...(dto.packagesPlanned !== undefined && { packagesPlanned: dto.packagesPlanned }),
        ...(dto.packagesActual !== undefined && { packagesActual: dto.packagesActual }),
        ...(dto.linesPlanned !== undefined && { linesPlanned: dto.linesPlanned }),
        ...(dto.linesActual !== undefined && { linesActual: dto.linesActual }),
        ...(dto.counterparty && { counterparty: dto.counterparty }),
        ...(dto.acceptanceDate && { acceptanceDate: new Date(dto.acceptanceDate) }),
        ...(dto.clientTIN && { clientTIN: dto.clientTIN })
      },
      include: { client: true }
    })
  }

  async remove(id: string, userId: string, userRole: string) {
    const order = await this.prisma.order.findUnique({
      where: { id }
    })

    if (!order) {
      throw new NotFoundException('Order not found')
    }

    // Админ может удалять любой Order
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(order.clientTIN)) {
        throw new ForbiddenException('Access denied to delete this order')
      }
    }

    return this.prisma.order.delete({
      where: { id },
      include: { client: true }
    })
  }
}


import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { RegistryDto, UpdateRegistryDto, FindRegistryDto } from './registry.dto'
import { Prisma } from '@prisma/client'

@Injectable()
export class RegistryService {
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
      // Админ может видеть любые Registry
      if (requestedTINs.length > 0) {
        // Если указан фильтр - используем его
        finalTINs = requestedTINs
      } else {
        // Если фильтр не указан - показываем все
        return this.prisma.registry.findMany({
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
        // Если фильтр не указан - показываем все Registry клиентов пользователя
        finalTINs = userClientTINs
      }
    }

    return this.prisma.registry.findMany({
      where: {
        clientTIN: {
          in: finalTINs
        }
      },
      include: { client: true },
      orderBy: { createdAt: 'desc' }
    })
  }

  async findAllWithPagination(dto: FindRegistryDto, userId: string, userRole: string) {
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
      // Админ может видеть любые Registry
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
        // Если фильтр не указан - показываем все Registry клиентов пользователя
        allowedTINs = userClientTINs
      }
    }

    // Формируем условия поиска
    const where: Prisma.RegistryWhereInput = {}
    
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

    if (dto.vehicleNumber) {
      const vehicleNumberTerm = dto.vehicleNumber.trim()
      if (vehicleNumberTerm) {
        where.vehicleNumber = { contains: vehicleNumberTerm, mode: 'insensitive' }
      }
    }

    if (dto.driverName) {
      const driverNameTerm = dto.driverName.trim()
      if (driverNameTerm) {
        where.driverName = { contains: driverNameTerm, mode: 'insensitive' }
      }
    }

    if (dto.orderNumber) {
      const orderNumberTerm = dto.orderNumber.trim()
      if (orderNumberTerm) {
        where.orderNumber = { contains: orderNumberTerm, mode: 'insensitive' }
      }
    }

    if (dto.orderType) {
      const orderTypeTerm = dto.orderType.trim()
      if (orderTypeTerm) {
        where.orderType = { contains: orderTypeTerm, mode: 'insensitive' }
      }
    }

    if (dto.status) {
      const statusTerm = dto.status.trim()
      if (statusTerm) {
        where.status = { contains: statusTerm, mode: 'insensitive' }
      }
    }

    if (dto.processingType) {
      const processingTypeTerm = dto.processingType.trim()
      if (processingTypeTerm) {
        where.processingType = { contains: processingTypeTerm, mode: 'insensitive' }
      }
    }

    // Общий поиск (если указан, работает вместе с отдельными фильтрами)
    if (dto.search) {
      const searchTerm = dto.search.trim()
      if (searchTerm) {
        // Если уже есть фильтры по отдельным полям, добавляем OR условие
        // Иначе используем OR для поиска по всем полям
        if (!dto.branch && !dto.counterparty && !dto.vehicleNumber && !dto.driverName && !dto.orderNumber && !dto.orderType && !dto.status && !dto.processingType) {
          where.OR = [
            { branch: { contains: searchTerm, mode: 'insensitive' } },
            { counterparty: { contains: searchTerm, mode: 'insensitive' } },
            { vehicleNumber: { contains: searchTerm, mode: 'insensitive' } },
            { driverName: { contains: searchTerm, mode: 'insensitive' } },
            { orderNumber: { contains: searchTerm, mode: 'insensitive' } },
            { orderType: { contains: searchTerm, mode: 'insensitive' } },
            { status: { contains: searchTerm, mode: 'insensitive' } },
            { processingType: { contains: searchTerm, mode: 'insensitive' } },
            { kisNumber: { contains: searchTerm, mode: 'insensitive' } },
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

    // Фильтрация по дате планового прибытия (shipmentPlan)
    if (dto.shipmentPlanFrom || dto.shipmentPlanTo) {
      const shipmentPlanFilter: { gte?: Date; lte?: Date } = {}
      
      if (dto.shipmentPlanFrom) {
        const fromDate = parseDateTime(dto.shipmentPlanFrom, false)
        if (fromDate) {
          shipmentPlanFilter.gte = fromDate
        }
      }
      
      if (dto.shipmentPlanTo) {
        const toDate = parseDateTime(dto.shipmentPlanTo, true)
        if (toDate) {
          shipmentPlanFilter.lte = toDate
        }
      }
      
      if (shipmentPlanFilter.gte || shipmentPlanFilter.lte) {
        where.shipmentPlan = shipmentPlanFilter
      }
    }

    // Фильтрация по дате фактического прибытия (unloadingDate)
    if (dto.unloadingDateFrom || dto.unloadingDateTo) {
      const unloadingDateFilter: { gte?: Date; lte?: Date } = {}
      
      if (dto.unloadingDateFrom) {
        const fromDate = parseDateTime(dto.unloadingDateFrom, false)
        if (fromDate) {
          unloadingDateFilter.gte = fromDate
        }
      }
      
      if (dto.unloadingDateTo) {
        const toDate = parseDateTime(dto.unloadingDateTo, true)
        if (toDate) {
          unloadingDateFilter.lte = toDate
        }
      }
      
      if (unloadingDateFilter.gte || unloadingDateFilter.lte) {
        where.unloadingDate = unloadingDateFilter
      }
    }

    // Фильтрация по дате убытия (departureDate)
    if (dto.departureDateFrom || dto.departureDateTo) {
      const departureDateFilter: { gte?: Date; lte?: Date } = {}
      
      if (dto.departureDateFrom) {
        const fromDate = parseDateTime(dto.departureDateFrom, false)
        if (fromDate) {
          departureDateFilter.gte = fromDate
        }
      }
      
      if (dto.departureDateTo) {
        const toDate = parseDateTime(dto.departureDateTo, true)
        if (toDate) {
          departureDateFilter.lte = toDate
        }
      }
      
      if (departureDateFilter.gte || departureDateFilter.lte) {
        where.departureDate = departureDateFilter
      }
    }

    // Формируем сортировку
    const orderBy: Prisma.RegistryOrderByWithRelationInput = {}
    if (dto.sortBy === 'acceptanceDate') {
      orderBy.acceptanceDate = dto.sortOrder || 'desc'
    } else if (dto.sortBy === 'unloadingDate') {
      orderBy.unloadingDate = dto.sortOrder || 'desc'
    } else if (dto.sortBy === 'shipmentPlan') {
      orderBy.shipmentPlan = dto.sortOrder || 'desc'
    } else if (dto.sortBy === 'departureDate') {
      orderBy.departureDate = dto.sortOrder || 'desc'
    } else {
      orderBy.orderNumber = dto.sortOrder || 'asc'
    }

    // Получаем общее количество записей (для пагинации)
    const total = await this.prisma.registry.count({ where })

    // Получаем данные
    const registries = await this.prisma.registry.findMany({
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
        unloadingDate: true,
        status: true,
        counterparty: true,
        acceptanceDate: true,
        shipmentPlan: true,
        packagesPlanned: true,
        packagesActual: true,
        linesPlanned: true,
        linesActual: true,
        vehicleNumber: true,
        driverName: true,
        processingType: true,
        departureDate: true,
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
      data: registries,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
    }
  }

  async findOne(id: string, userId: string, userRole: string) {
    const registry = await this.prisma.registry.findUnique({
      where: { id },
      include: { client: true }
    })

    if (!registry) {
      throw new NotFoundException('Registry not found')
    }

    // Админ может видеть все Registry
    if (userRole === 'ADMIN') {
      return registry
    }

    // Обычный пользователь может видеть только Registry своих клиентов
    const clientTINs = await this.getUserClientTINs(userId)

    if (clientTINs.length === 0 || !clientTINs.includes(registry.clientTIN)) {
      throw new ForbiddenException('Access denied to this registry')
    }

    return registry
  }

  async create(dto: RegistryDto, userId: string, userRole: string) {
    // Админ может создавать Registry для любого клиента
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(dto.clientTIN)) {
        throw new ForbiddenException('Access denied to create registry for this client')
      }
    }

    // Проверяем существование клиента
    const client = await this.prisma.client.findUnique({
      where: { TIN: dto.clientTIN }
    })

    if (!client) {
      throw new NotFoundException('Client with this TIN not found')
    }

    return this.prisma.registry.create({
      data: {
        branch: dto.branch,
        orderType: dto.orderType,
        orderNumber: dto.orderNumber,
        kisNumber: dto.kisNumber,
        unloadingDate: new Date(dto.unloadingDate),
        status: dto.status,
        counterparty: dto.counterparty,
        acceptanceDate: new Date(dto.acceptanceDate),
        shipmentPlan: new Date(dto.shipmentPlan),
        packagesPlanned: dto.packagesPlanned,
        packagesActual: dto.packagesActual,
        linesPlanned: dto.linesPlanned,
        linesActual: dto.linesActual,
        vehicleNumber: dto.vehicleNumber,
        driverName: dto.driverName,
        processingType: dto.processingType,
        departureDate: dto.departureDate ? new Date(dto.departureDate) : null,
        clientTIN: dto.clientTIN
      },
      include: { client: true }
    })
  }

  async update(id: string, dto: UpdateRegistryDto, userId: string, userRole: string) {
    const registry = await this.prisma.registry.findUnique({
      where: { id }
    })

    if (!registry) {
      throw new NotFoundException('Registry not found')
    }

    // Админ может обновлять любой Registry
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(registry.clientTIN)) {
        throw new ForbiddenException('Access denied to update this registry')
      }

      // Если пытаются изменить clientTIN, проверяем доступ к новому клиенту
      if (dto.clientTIN && dto.clientTIN !== registry.clientTIN) {
        if (!clientTINs.includes(dto.clientTIN)) {
          throw new ForbiddenException('Access denied to assign registry to this client')
        }
      }
    }

    // Если пытаются изменить clientTIN, проверяем существование нового клиента
    if (dto.clientTIN && dto.clientTIN !== registry.clientTIN) {
      const newClient = await this.prisma.client.findUnique({
        where: { TIN: dto.clientTIN }
      })

      if (!newClient) {
        throw new NotFoundException('Client with this TIN not found')
      }
    }

    return this.prisma.registry.update({
      where: { id },
      data: {
        ...(dto.branch && { branch: dto.branch }),
        ...(dto.orderType && { orderType: dto.orderType }),
        ...(dto.orderNumber && { orderNumber: dto.orderNumber }),
        ...(dto.kisNumber && { kisNumber: dto.kisNumber }),
        ...(dto.unloadingDate && { unloadingDate: new Date(dto.unloadingDate) }),
        ...(dto.status && { status: dto.status }),
        ...(dto.counterparty && { counterparty: dto.counterparty }),
        ...(dto.acceptanceDate && { acceptanceDate: new Date(dto.acceptanceDate) }),
        ...(dto.shipmentPlan && { shipmentPlan: new Date(dto.shipmentPlan) }),
        ...(dto.packagesPlanned !== undefined && { packagesPlanned: dto.packagesPlanned }),
        ...(dto.packagesActual !== undefined && { packagesActual: dto.packagesActual }),
        ...(dto.linesPlanned !== undefined && { linesPlanned: dto.linesPlanned }),
        ...(dto.linesActual !== undefined && { linesActual: dto.linesActual }),
        ...(dto.vehicleNumber !== undefined && { vehicleNumber: dto.vehicleNumber }),
        ...(dto.driverName !== undefined && { driverName: dto.driverName }),
        ...(dto.processingType !== undefined && { processingType: dto.processingType }),
        ...(dto.departureDate !== undefined && { departureDate: dto.departureDate ? new Date(dto.departureDate) : null }),
        ...(dto.clientTIN && { clientTIN: dto.clientTIN })
      },
      include: { client: true }
    })
  }

  async remove(id: string, userId: string, userRole: string) {
    const registry = await this.prisma.registry.findUnique({
      where: { id }
    })

    if (!registry) {
      throw new NotFoundException('Registry not found')
    }

    // Админ может удалять любой Registry
    if (userRole !== 'ADMIN') {
      const clientTINs = await this.getUserClientTINs(userId)

      if (!clientTINs.includes(registry.clientTIN)) {
        throw new ForbiddenException('Access denied to delete this registry')
      }
    }

    return this.prisma.registry.delete({
      where: { id },
      include: { client: true }
    })
  }

  async getLastImportInfo() {
    const metadata = await this.prisma.importMetadata.findUnique({
      where: { importType: 'registry' }
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


import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { RegistryDto, UpdateRegistryDto } from './registry.dto'

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
}


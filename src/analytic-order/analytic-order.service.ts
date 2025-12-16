import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { FindAnalyticOrderDto } from './analytic-order.dto'
import { Prisma } from '@prisma/client'

@Injectable()
export class AnalyticOrderService {
  constructor(private readonly prisma: PrismaService) {}

  private async getUserClientTINs(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { clients: { select: { TIN: true }, orderBy: { createdAt: 'asc' } } }
    })

    return user?.clients?.map(client => client.TIN) || []
  }

  async getChartData(dto: FindAnalyticOrderDto, userId: string, userRole: string) {
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
      // Админ может видеть любые analytic_orders
      if (requestedTINs.length > 0) {
        allowedTINs = requestedTINs
      } else {
        // Если фильтр не указан - возвращаем пустой массив (все клиенты)
        allowedTINs = []
      }
    } else {
      // Обычный пользователь
      if (userClientTINs.length === 0) {
        return {
          data: [],
          defaultClientTIN: null,
          availableClients: [],
          lastImportAt: null,
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
        // Если фильтр не указан - используем первый доступный клиент по умолчанию
        allowedTINs = [userClientTINs[0]]
      }
    }

    // Формируем условия фильтрации
    const where: Prisma.AnalyticOrderWhereInput = {}
    
    // Фильтр по клиентам
    if (allowedTINs.length > 0) {
      where.clientTIN = { in: allowedTINs }
    } else if (userRole !== 'ADMIN') {
      // Для не-админа без клиентов - пустой результат
      return {
        data: [],
        defaultClientTIN: null,
        availableClients: [],
        lastImportAt: null,
      }
    }

    // Получаем данные с группировкой по дате (суммируем значения для всех выбранных клиентов)
    const analyticOrderRecords = await this.prisma.analyticOrder.findMany({
      where,
      orderBy: { date: 'asc' },
      select: {
        date: true,
        quantityByPlannedDate: true,
        quantityByActualDate: true,
      }
    })

    // Группируем по дате и суммируем значения
    const groupedData = new Map<string, {
      date: Date
      quantityByPlannedDate: number
      quantityByActualDate: number
    }>()

    analyticOrderRecords.forEach(record => {
      const dateKey = record.date.toISOString().split('T')[0]
      const existing = groupedData.get(dateKey)

      if (existing) {
        existing.quantityByPlannedDate += record.quantityByPlannedDate
        existing.quantityByActualDate += record.quantityByActualDate
      } else {
        groupedData.set(dateKey, {
          date: record.date,
          quantityByPlannedDate: record.quantityByPlannedDate,
          quantityByActualDate: record.quantityByActualDate,
        })
      }
    })

    // Преобразуем в массив и сортируем по дате
    const chartData = Array.from(groupedData.values())
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map(item => ({
        date: item.date.toISOString().split('T')[0],
        quantityByPlannedDate: item.quantityByPlannedDate,
        quantityByActualDate: item.quantityByActualDate,
      }))

    // Получаем информацию о доступных клиентах
    const availableClientsWhere: Prisma.ClientWhereInput = {}
    if (userRole !== 'ADMIN') {
      availableClientsWhere.TIN = { in: userClientTINs }
    }

    const availableClients = await this.prisma.client.findMany({
      where: availableClientsWhere,
      select: {
        TIN: true,
        companyName: true,
      },
      orderBy: { createdAt: 'asc' }
    })

    // Получаем информацию о последнем импорте
    const lastImportInfo = await this.getLastImportInfo()

    return {
      data: chartData,
      defaultClientTIN: userClientTINs.length > 0 ? userClientTINs[0] : null,
      availableClients: availableClients,
      lastImportAt: lastImportInfo.lastImportAt,
    }
  }

  async getLastImportInfo() {
    const metadata = await this.prisma.importMetadata.findUnique({
      where: { importType: 'analytic_orders' }
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


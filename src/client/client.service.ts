import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { ClientDto, FindClientsDto } from './client.dto'
import { Prisma } from '@prisma/client'

@Injectable()
export class ClientService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.client.findMany({
      include: { users: true, stocks: true }
    })
  }

  async findAllWithPagination(dto: FindClientsDto) {
    const page = dto.page || 1
    const limit = Math.min(dto.limit || 20, 50) // Максимум 50 записей
    const skip = (page - 1) * limit

    // Формируем условия поиска
    const where: Prisma.ClientWhereInput = {}
    
    if (dto.search) {
      const searchTerm = dto.search.trim()
      where.OR = [
        { companyName: { contains: searchTerm, mode: 'insensitive' } },
        { TIN: { contains: searchTerm, mode: 'insensitive' } },
      ]
    }

    // Формируем сортировку
    const orderBy: Prisma.ClientOrderByWithRelationInput = {}
    if (dto.sortBy === 'createdAt') {
      orderBy.createdAt = dto.sortOrder || 'asc'
    } else {
      orderBy.companyName = dto.sortOrder || 'asc'
    }

    // Получаем общее количество записей (для пагинации)
    const total = await this.prisma.client.count({ where })

    // Получаем данные
    const clients = await this.prisma.client.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      // Не загружаем связанные данные для списка (для производительности)
      // Если нужно - можно сделать опциональным
      select: {
        id: true,
        TIN: true,
        companyName: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            users: true,
            stocks: true,
            registries: true,
          }
        }
      }
    })

    return {
      data: clients,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
    }
  }

  async create(dto: ClientDto) {
    return this.prisma.client.create({
      data: {
        TIN: dto.TIN,
        companyName: dto.companyName,
        users: dto.userIds
          ? { connect: dto.userIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { users: true },
    })
  }

  async update(id: string, dto: ClientDto) {
    return this.prisma.client.update({
      where: { id },
      data: {
        TIN: dto.TIN,
        companyName: dto.companyName,
        ...(dto.userIds && {
          users: {
            set: [],
            connect: dto.userIds.map((id) => ({ id })),
          },
        }),
      },
      include: { users: true },
    })
  }

  async remove(id: string) {
    return this.prisma.client.delete({ where: { id } })
  }
}

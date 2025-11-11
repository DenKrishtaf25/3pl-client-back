import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/prisma.service'
import { ClientDto } from './client.dto'

@Injectable()
export class ClientService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.client.findMany({
      include: { users: true, stocks: true }
    })
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

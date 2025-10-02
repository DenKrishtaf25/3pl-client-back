import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/prisma.service'
import { ClientDto } from './client.dto'

@Injectable()
export class ClientService {
    constructor(private readonly prisma: PrismaService) { }

    async findAll() {
        return this.prisma.client.findMany({
            include: { user: true, inventories: true }
        })
    }

    async create(dto: ClientDto) {
        return this.prisma.client.create({
            data: {
                TIN: dto.TIN,
                companyName: dto.companyName,
                user: { connect: { id: dto.userId } }
            }
        })
    }

    async update(id: string, dto: ClientDto) {
        return this.prisma.client.update({
            where: { id },
            data: {
                TIN: dto.TIN,
                companyName: dto.companyName,
                user: { connect: { id: dto.userId } }
            }
        })
    }

    async remove(id: string) {
        return this.prisma.client.delete({ where: { id } })
    }
}

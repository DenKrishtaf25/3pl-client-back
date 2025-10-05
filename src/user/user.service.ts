import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from 'src/prisma.service'
import { AuthDto } from '../auth/dto/auth.dto'
import { UserDto } from './user.dto'
import { hash } from 'argon2'

@Injectable()
export class UserService {
	constructor(private prisma: PrismaService) {
	}

	getById(id: string) {
		return this.prisma.user.findUnique({
			where: { id },
			include: {
				clients: true
			}
		})
	}

	getByEmail(email: string) {
		return this.prisma.user.findUnique({
			where: { email }
		})
	}

	async getProfile(id: string) {
		const profile = await this.getById(id)

		if (!profile) {
			throw new Error('User not found');
		}

		const totalClients = profile.clients.length

		const { password, ...rest } = profile

		return {
			user: rest,
			statistics: [
				{ label: 'Total', value: totalClients },
			]
		}
	}

	async create(dto: UserDto) {
		if (!dto.password) throw new BadRequestException('Password is required')
		if (!dto.TINs || dto.TINs.length === 0) {
			throw new BadRequestException('At least one TIN must be provided')
		}

		const clients = await this.prisma.client.findMany({
			where: { TIN: { in: dto.TINs } },
			select: { id: true },
		})

		if (clients.length === 0) {
			throw new BadRequestException('No clients found for provided TINs')
		}

		const user = await this.prisma.user.create({
			data: {
				email: dto.email,
				name: dto.name ?? '',
				password: await hash(dto.password),
				role: dto.role ?? 'USER',
				clients: {
					connect: clients.map((c) => ({ id: c.id })),
				},
			},
			include: { clients: true },
		})

		return user
	}


	async update(id: string, dto: UserDto) {
		let data = dto
		if (dto.password) {
			data = { ...dto, password: await hash(dto.password) }
		}
		return this.prisma.user.update({
			where: { id },
			data,
			select: {
				name: true,
				email: true
			}
		})
	}

	findAll() {
		return this.prisma.user.findMany({
			select: {
				id: true,
				createdAt: true,
				updatedAt: true,
				email: true,
				name: true,
				password: true,
				role: true,
				clients: true
			}
		})
	}
}
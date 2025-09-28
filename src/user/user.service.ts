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

		const totalClients= profile.clients.length
		
		const { password, ...rest } = profile

		return {
			user: rest,
			statistics: [
				{label: 'Total', value: totalClients},
			]
		}
	}

	async create(dto: UserDto) {
		const user = {
			email: dto.email,
			name: dto.name ?? '',
			password: await hash(dto.password),
			role: dto.role ?? 'USER'
		}

		if (!dto.password) throw new BadRequestException('Password is required')

		return this.prisma.user.create({
			data: user
		})
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
				email: true,
				role: true,
				createdAt: true
			}
		})
	}
}
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { UserDto } from './user.dto'
import { hash } from 'argon2'
import { EmailService } from '../email/email.service'

@Injectable()
export class UserService {
	private readonly logger = new Logger(UserService.name)

	constructor(
		private prisma: PrismaService,
		private emailService: EmailService
	) {
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

		// Отправка email с учетными данными, если указан флаг sendEmail
		this.logger.log(`Creating user - sendEmail flag: ${dto.sendEmail}, email: ${dto.email}`)
		
		if (dto.sendEmail === true && dto.email) {
			this.logger.log(`Attempting to send registration email to ${dto.email}`)
			try {
				await this.emailService.sendRegistrationEmail(dto.email, dto.password)
				this.logger.log(`Registration email sent successfully to ${dto.email}`)
			} catch (error) {
				// Логируем ошибку, но не прерываем создание пользователя
				this.logger.error(`Failed to send registration email to ${dto.email}:`, error)
			}
		} else {
			this.logger.log(`Email not sent - sendEmail: ${dto.sendEmail}, email: ${dto.email}`)
		}

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

	async fullUpdate(id: string, dto: UserDto) {
		const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
		if (existingUser && existingUser.id !== id) {
			throw new BadRequestException('Email уже используется');
		}

		let clientsConnect = undefined;
		if (dto.TINs && dto.TINs.length) {
			const clients = await this.prisma.client.findMany({
				where: { TIN: { in: dto.TINs } },
				select: { id: true },
			});

			if (!clients.length) {
				throw new BadRequestException('Нет клиентов для указанных TIN');
			}

			clientsConnect = clients.map(c => ({ id: c.id }));
		}

		const data: any = {
			email: dto.email,
			name: dto.name
		};

		if (dto.password) {
			data.password = await hash(dto.password);
		}

		if (clientsConnect) {
			data.clients = {
				set: clientsConnect,
			};
		}

		return this.prisma.user.update({
			where: { id },
			data,
			include: { clients: true },
		});
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

	async remove(id: string) {
		return this.prisma.user.delete({
			where: { id },
		});
	}
}
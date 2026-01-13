import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { PrismaService } from '../prisma.service'
import { UserController, AdminUsersController } from './user.controller'
import { UserService } from './user.service'
import { EmailService } from '../email/email.service'

@Module({
	imports: [ConfigModule],
	controllers: [UserController, AdminUsersController],
	providers: [UserService, PrismaService, EmailService],
	exports: [UserService]
})
export class UserModule {}

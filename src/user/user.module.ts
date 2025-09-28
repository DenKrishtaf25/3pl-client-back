import { Module } from '@nestjs/common'
import { PrismaService } from 'src/prisma.service'
import { UserController, AdminUsersController } from './user.controller'
import { UserService } from './user.service'

@Module({
	controllers: [UserController, AdminUsersController],
	providers: [UserService, PrismaService],
	exports: [UserService]
})
export class UserModule {}

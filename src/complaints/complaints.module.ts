import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ComplaintsService } from './complaints.service'
import { UserComplaintsController, AdminComplaintsController } from './complaints.controller'
import { PrismaService } from '../prisma.service'
import { EmailService } from '../email/email.service'

@Module({
  imports: [ConfigModule],
  controllers: [UserComplaintsController, AdminComplaintsController],
  providers: [ComplaintsService, PrismaService, EmailService]
})
export class ComplaintsModule {}


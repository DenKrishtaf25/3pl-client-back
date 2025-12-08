import { Module } from '@nestjs/common'
import { ComplaintsService } from './complaints.service'
import { UserComplaintsController, AdminComplaintsController } from './complaints.controller'
import { PrismaService } from '../prisma.service'

@Module({
  controllers: [UserComplaintsController, AdminComplaintsController],
  providers: [ComplaintsService, PrismaService]
})
export class ComplaintsModule {}


import { Module } from '@nestjs/common'
import { FinanceService } from './finance.service'
import { UserFinanceController, AdminFinanceController } from './finance.controller'
import { PrismaService } from '../prisma.service'

@Module({
  controllers: [UserFinanceController, AdminFinanceController],
  providers: [FinanceService, PrismaService]
})
export class FinanceModule {}


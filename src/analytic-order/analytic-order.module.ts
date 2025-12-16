import { Module } from '@nestjs/common'
import { AnalyticOrderService } from './analytic-order.service'
import { AnalyticOrderController } from './analytic-order.controller'
import { PrismaService } from '../prisma.service'

@Module({
  controllers: [AnalyticOrderController],
  providers: [AnalyticOrderService, PrismaService]
})
export class AnalyticOrderModule {}


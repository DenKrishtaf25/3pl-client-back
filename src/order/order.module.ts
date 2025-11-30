import { Module } from '@nestjs/common'
import { OrderService } from './order.service'
import { UserOrderController, AdminOrderController } from './order.controller'
import { PrismaService } from '../prisma.service'

@Module({
  controllers: [UserOrderController, AdminOrderController],
  providers: [OrderService, PrismaService]
})
export class OrderModule {}


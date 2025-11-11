import { Module } from '@nestjs/common'
import { StockService } from './stock.service'
import { UserStockController, AdminStockController } from './stock.controller'
import { PrismaService } from 'src/prisma.service'

@Module({
  controllers: [UserStockController, AdminStockController],
  providers: [StockService, PrismaService]
})
export class StockModule {}


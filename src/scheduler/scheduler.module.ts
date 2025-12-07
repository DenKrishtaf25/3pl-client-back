import { Module } from '@nestjs/common'
import { StockImportService } from './stock-import.service'
import { RegistryImportService } from './registry-import.service'
import { OrderImportService } from './order-import.service'

@Module({
  providers: [StockImportService, RegistryImportService, OrderImportService],
  exports: [StockImportService, RegistryImportService, OrderImportService],
})
export class SchedulerModule {}


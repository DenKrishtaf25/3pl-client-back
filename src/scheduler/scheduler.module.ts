import { Module } from '@nestjs/common'
import { StockImportService } from './stock-import.service'
import { RegistryImportService } from './registry-import.service'
import { OrderImportService } from './order-import.service'
import { AnalyticsImportService } from './analytics-import.service'

@Module({
  providers: [StockImportService, RegistryImportService, OrderImportService, AnalyticsImportService],
  exports: [StockImportService, RegistryImportService, OrderImportService, AnalyticsImportService],
})
export class SchedulerModule {}


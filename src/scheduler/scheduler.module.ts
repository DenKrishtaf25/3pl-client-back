import { Module } from '@nestjs/common'
import { StockImportService } from './stock-import.service'
import { RegistryImportService } from './registry-import.service'
import { OrderImportService } from './order-import.service'
import { AnalyticsImportService } from './analytics-import.service'
import { FinanceImportService } from './finance-import.service'

@Module({
  providers: [StockImportService, RegistryImportService, OrderImportService, AnalyticsImportService, FinanceImportService],
  exports: [StockImportService, RegistryImportService, OrderImportService, AnalyticsImportService, FinanceImportService],
})
export class SchedulerModule {}


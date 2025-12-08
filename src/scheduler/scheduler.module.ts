import { Module } from '@nestjs/common'
import { StockImportService } from './stock-import.service'
import { RegistryImportService } from './registry-import.service'
import { OrderImportService } from './order-import.service'
import { AnalyticsImportService } from './analytics-import.service'
import { FinanceImportService } from './finance-import.service'
import { ComplaintsImportService } from './complaints-import.service'

@Module({
  providers: [StockImportService, RegistryImportService, OrderImportService, AnalyticsImportService, FinanceImportService, ComplaintsImportService],
  exports: [StockImportService, RegistryImportService, OrderImportService, AnalyticsImportService, FinanceImportService, ComplaintsImportService],
})
export class SchedulerModule {}


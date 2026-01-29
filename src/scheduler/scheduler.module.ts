import { Module } from '@nestjs/common'
import { StockImportService } from './stock-import.service'
import { RegistryImportService } from './registry-import.service'
import { OrderImportService } from './order-import.service'
import { OrderOnlineImportService } from './order-online-import.service'
import { AnalyticsImportService } from './analytics-import.service'
import { AnalyticOrderImportService } from './analytic-order-import.service'
import { FinanceImportService } from './finance-import.service'
import { ComplaintsImportService } from './complaints-import.service'
import { ImportManagerService } from './import-manager.service'

@Module({
  providers: [
    StockImportService,
    RegistryImportService,
    OrderImportService,
    OrderOnlineImportService,
    AnalyticsImportService,
    AnalyticOrderImportService,
    FinanceImportService,
    ComplaintsImportService,
    ImportManagerService,
  ],
  exports: [
    StockImportService,
    RegistryImportService,
    OrderImportService,
    OrderOnlineImportService,
    AnalyticsImportService,
    AnalyticOrderImportService,
    FinanceImportService,
    ComplaintsImportService,
    ImportManagerService,
  ],
})
export class SchedulerModule {}


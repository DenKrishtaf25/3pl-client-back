import { Module } from '@nestjs/common'
import { StockImportService } from './stock-import.service'

@Module({
  providers: [StockImportService],
  exports: [StockImportService],
})
export class SchedulerModule {}


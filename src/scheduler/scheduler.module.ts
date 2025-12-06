import { Module } from '@nestjs/common'
import { StockImportService } from './stock-import.service'
import { RegistryImportService } from './registry-import.service'

@Module({
  providers: [StockImportService, RegistryImportService],
  exports: [StockImportService, RegistryImportService],
})
export class SchedulerModule {}


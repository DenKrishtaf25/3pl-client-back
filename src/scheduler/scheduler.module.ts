import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { StockImportService } from './stock-import.service'

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [StockImportService],
  exports: [StockImportService],
})
export class SchedulerModule {}


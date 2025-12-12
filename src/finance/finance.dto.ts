import { IsString, IsNumber, IsOptional, IsDateString, IsInt, Min, Max, IsEnum } from 'class-validator'
import { Type } from 'class-transformer'

export class FinanceDto {
  @IsString()
  branch: string

  @IsString()
  counterparty: string

  @IsDateString()
  date: string

  @IsString()
  orderNumber: string

  @IsNumber()
  amount: number

  @IsString()
  status: string

  @IsOptional()
  @IsString()
  comment?: string

  @IsOptional()
  @IsDateString()
  completionDate?: string

  @IsOptional()
  @IsDateString()
  closingDate?: string

  @IsString()
  clientTIN: string
}

export class UpdateFinanceDto {
  @IsOptional()
  @IsString()
  branch?: string

  @IsOptional()
  @IsString()
  counterparty?: string

  @IsOptional()
  @IsDateString()
  date?: string

  @IsOptional()
  @IsDateString()
  completionDate?: string

  @IsOptional()
  @IsDateString()
  closingDate?: string

  @IsOptional()
  @IsString()
  orderNumber?: string

  @IsOptional()
  @IsNumber()
  amount?: number

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsString()
  comment?: string

  @IsOptional()
  @IsString()
  clientTIN?: string
}

export class FindFinanceDto {
  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsString()
  branch?: string

  @IsOptional()
  @IsString()
  counterparty?: string

  @IsOptional()
  @IsString()
  orderNumber?: string

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number

  @IsOptional()
  @IsEnum(['orderNumber', 'date', 'amount', 'completionDate', 'closingDate'])
  sortBy?: 'orderNumber' | 'date' | 'amount' | 'completionDate' | 'closingDate'

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc'

  @IsOptional()
  @IsString()
  clientTIN?: string

  // Фильтры по дате
  @IsOptional()
  @IsDateString()
  dateFrom?: string

  @IsOptional()
  @IsDateString()
  dateTo?: string

  // Фильтры по дате завершения
  @IsOptional()
  @IsDateString()
  completionDateFrom?: string

  @IsOptional()
  @IsDateString()
  completionDateTo?: string

  // Фильтры по дате закрытия
  @IsOptional()
  @IsDateString()
  closingDateFrom?: string

  @IsOptional()
  @IsDateString()
  closingDateTo?: string

  // Фильтры по сумме
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amountFrom?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amountTo?: number
}

export class FinanceStatusStatsDto {
  @IsOptional()
  @IsEnum(['amount', 'count'])
  sortBy?: 'amount' | 'count'

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc'
}


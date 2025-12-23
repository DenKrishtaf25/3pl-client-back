import { IsString, IsNumber, IsOptional, IsDateString, IsInt, Min, Max, IsEnum } from 'class-validator'
import { Type } from 'class-transformer'

export class OrderDto {
  @IsString()
  branch: string

  @IsString()
  orderType: string

  @IsString()
  orderNumber: string

  @IsString()
  kisNumber: string

  @IsDateString()
  exportDate: string

  @IsOptional()
  @IsDateString()
  shipmentDate?: string

  @IsString()
  status: string

  @IsNumber()
  packagesPlanned: number

  @IsNumber()
  packagesActual: number

  @IsNumber()
  linesPlanned: number

  @IsNumber()
  linesActual: number

  @IsString()
  counterparty: string

  @IsOptional()
  @IsDateString()
  acceptanceDate?: string

  @IsString()
  clientTIN: string
}

export class UpdateOrderDto {
  @IsOptional()
  @IsString()
  branch?: string

  @IsOptional()
  @IsString()
  orderType?: string

  @IsOptional()
  @IsString()
  orderNumber?: string

  @IsOptional()
  @IsString()
  kisNumber?: string

  @IsOptional()
  @IsDateString()
  exportDate?: string

  @IsOptional()
  @IsDateString()
  shipmentDate?: string

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsNumber()
  packagesPlanned?: number

  @IsOptional()
  @IsNumber()
  packagesActual?: number

  @IsOptional()
  @IsNumber()
  linesPlanned?: number

  @IsOptional()
  @IsNumber()
  linesActual?: number

  @IsOptional()
  @IsString()
  counterparty?: string

  @IsOptional()
  @IsDateString()
  acceptanceDate?: string

  @IsOptional()
  @IsString()
  clientTIN?: string
}

export class FindOrderDto {
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
  orderType?: string

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsString()
  kisNumber?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  limit?: number

  @IsOptional()
  @IsEnum(['orderNumber', 'exportDate', 'shipmentDate', 'acceptanceDate'])
  sortBy?: 'orderNumber' | 'exportDate' | 'shipmentDate' | 'acceptanceDate'

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc'

  @IsOptional()
  @IsString()
  clientTIN?: string

  // Фильтры по дате приемки/отгрузки (acceptanceDate)
  @IsOptional()
  @IsDateString()
  acceptanceDateFrom?: string

  @IsOptional()
  @IsDateString()
  acceptanceDateTo?: string

  // Фильтры по дате экспорта (exportDate)
  @IsOptional()
  @IsDateString()
  exportDateFrom?: string

  @IsOptional()
  @IsDateString()
  exportDateTo?: string

  // Фильтры по дате отгрузки (shipmentDate)
  @IsOptional()
  @IsDateString()
  shipmentDateFrom?: string

  @IsOptional()
  @IsDateString()
  shipmentDateTo?: string
}


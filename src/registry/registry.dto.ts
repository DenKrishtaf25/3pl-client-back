import { IsString, IsNumber, IsOptional, IsDateString, IsInt, Min, Max, IsEnum } from 'class-validator'
import { Type } from 'class-transformer'

export class RegistryDto {
  @IsString()
  branch: string

  @IsString()
  orderType: string

  @IsString()
  orderNumber: string

  @IsString()
  kisNumber: string

  @IsDateString()
  unloadingDate: string

  @IsString()
  status: string

  @IsString()
  counterparty: string

  @IsDateString()
  acceptanceDate: string

  @IsDateString()
  shipmentPlan: string

  @IsNumber()
  packagesPlanned: number

  @IsNumber()
  packagesActual: number

  @IsNumber()
  linesPlanned: number

  @IsNumber()
  linesActual: number

  @IsString()
  clientTIN: string
}

export class UpdateRegistryDto {
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
  unloadingDate?: string

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsString()
  counterparty?: string

  @IsOptional()
  @IsDateString()
  acceptanceDate?: string

  @IsOptional()
  @IsDateString()
  shipmentPlan?: string

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
  clientTIN?: string
}

export class FindRegistryDto {
  @IsOptional()
  @IsString()
  search?: string

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
  @IsEnum(['orderNumber', 'acceptanceDate', 'unloadingDate', 'shipmentPlan'])
  sortBy?: 'orderNumber' | 'acceptanceDate' | 'unloadingDate' | 'shipmentPlan'

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc'

  @IsOptional()
  @IsString()
  clientTIN?: string

  @IsOptional()
  @IsDateString()
  dateFrom?: string

  @IsOptional()
  @IsDateString()
  dateTo?: string

  @IsOptional()
  @IsEnum(['acceptanceDate', 'unloadingDate', 'shipmentPlan'])
  dateField?: 'acceptanceDate' | 'unloadingDate' | 'shipmentPlan'
}


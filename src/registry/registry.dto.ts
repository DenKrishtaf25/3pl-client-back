import { IsString, IsNumber, IsOptional, IsDateString } from 'class-validator'

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


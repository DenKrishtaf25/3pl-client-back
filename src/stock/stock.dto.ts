import { IsString, IsNumber, IsOptional } from 'class-validator'

export class StockDto {
  @IsString()
  warehouse: string

  @IsString()
  nomenclature: string

  @IsString()
  article: string

  @IsNumber()
  quantity: number

  @IsString()
  clientTIN: string
}

export class UpdateStockDto {
  @IsOptional()
  @IsString()
  warehouse?: string

  @IsOptional()
  @IsString()
  nomenclature?: string

  @IsOptional()
  @IsString()
  article?: string

  @IsOptional()
  @IsNumber()
  quantity?: number

  @IsOptional()
  @IsString()
  clientTIN?: string
}
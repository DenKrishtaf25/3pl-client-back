import { IsString, IsNumber, IsOptional, IsInt, Min, Max, IsEnum } from 'class-validator'
import { Type } from 'class-transformer'

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

export class FindStockDto {
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
  @IsEnum(['article', 'quantity'])
  sortBy?: 'article' | 'quantity'

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc'

  @IsOptional()
  @IsString()
  clientTIN?: string
}
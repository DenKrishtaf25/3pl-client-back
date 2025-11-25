import { IsString, IsArray, IsOptional, IsInt, Min, Max, IsEnum } from 'class-validator'
import { Type } from 'class-transformer'

export class ClientDto {
  @IsString()
  TIN: string

  @IsString()
  companyName: string

  @IsOptional()
  @IsArray()
  userIds?: string[]
}

export class FindClientsDto {
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
  @IsEnum(['companyName', 'createdAt'])
  sortBy?: 'companyName' | 'createdAt'

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc'
}

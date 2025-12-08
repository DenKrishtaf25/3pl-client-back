import { IsString, IsOptional, IsDateString, IsInt, Min, Max, IsEnum, IsBoolean } from 'class-validator'
import { Type } from 'class-transformer'

export class ComplaintDto {
  @IsString()
  branch: string

  @IsString()
  client: string

  @IsDateString()
  creationDate: string

  @IsString()
  complaintNumber: string

  @IsString()
  complaintType: string

  @IsString()
  status: string

  @IsBoolean()
  confirmation: boolean

  @IsString()
  clientTIN: string
}

export class UpdateComplaintDto {
  @IsOptional()
  @IsString()
  branch?: string

  @IsOptional()
  @IsString()
  client?: string

  @IsOptional()
  @IsDateString()
  creationDate?: string

  @IsOptional()
  @IsString()
  complaintNumber?: string

  @IsOptional()
  @IsString()
  complaintType?: string

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsBoolean()
  confirmation?: boolean

  @IsOptional()
  @IsString()
  clientTIN?: string
}

export class FindComplaintDto {
  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsString()
  branch?: string

  @IsOptional()
  @IsString()
  client?: string

  @IsOptional()
  @IsString()
  complaintNumber?: string

  @IsOptional()
  @IsString()
  complaintType?: string

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  confirmation?: boolean

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
  @IsEnum(['complaintNumber', 'creationDate', 'status'])
  sortBy?: 'complaintNumber' | 'creationDate' | 'status'

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
}


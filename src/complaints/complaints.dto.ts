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

  @IsOptional()
  @IsDateString()
  deadline?: string

  @IsOptional()
  @IsDateString()
  completionDate?: string

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
  @IsDateString()
  deadline?: string

  @IsOptional()
  @IsDateString()
  completionDate?: string

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
  @IsEnum(['complaintNumber', 'creationDate', 'status', 'deadline', 'completionDate'])
  sortBy?: 'complaintNumber' | 'creationDate' | 'status' | 'deadline' | 'completionDate'

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc'

  @IsOptional()
  @IsString()
  clientTIN?: string

  // Фильтры по дате создания
  @IsOptional()
  @IsDateString()
  dateFrom?: string

  @IsOptional()
  @IsDateString()
  dateTo?: string

  // Фильтры по крайнему сроку
  @IsOptional()
  @IsDateString()
  deadlineFrom?: string

  @IsOptional()
  @IsDateString()
  deadlineTo?: string

  // Фильтры по дате завершения
  @IsOptional()
  @IsDateString()
  completionDateFrom?: string

  @IsOptional()
  @IsDateString()
  completionDateTo?: string
}

export class ComplaintStatusStatsDto {
  // Пустой DTO - сортировка и фильтры не нужны
}


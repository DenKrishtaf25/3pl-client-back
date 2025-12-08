import { IsString, IsOptional } from 'class-validator'

export class FindAnalyticsDto {
  @IsOptional()
  @IsString()
  clientTIN?: string // Может быть строка с запятыми для нескольких клиентов
}


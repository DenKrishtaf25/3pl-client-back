import { IsString, IsOptional } from 'class-validator'

export class FindAnalyticOrderDto {
  @IsOptional()
  @IsString()
  clientTIN?: string // Может быть строка с запятыми для нескольких клиентов
}


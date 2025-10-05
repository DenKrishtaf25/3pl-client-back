import { IsString, IsArray, IsOptional } from 'class-validator'

export class ClientDto {
  @IsString()
  TIN: string

  @IsString()
  companyName: string

  @IsOptional()
  @IsArray()
  userIds?: string[]
}

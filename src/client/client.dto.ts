import { IsNotEmpty, IsString } from 'class-validator'

export class ClientDto {
    @IsNotEmpty()
    @IsString()
    TIN: string

    @IsNotEmpty()
    @IsString()
    companyName: string

    @IsNotEmpty()
    @IsString()
    userId: string
}

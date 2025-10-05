import {
	IsEmail,
	IsOptional,
	IsString,
	MinLength,
	IsArray,
	IsNotEmpty,
	IsEnum
} from 'class-validator'
import { Role } from '@prisma/client'


export class UserDto {
	@IsOptional()
	@IsEmail()
	email?: string

	@IsOptional()
	@IsString()
	name?: string

	@IsOptional()
	@MinLength(6, {
		message: 'Password must be at least 6 characters long'
	})
	@IsString()
	password?: string

	@IsOptional()
	@IsArray()
  	@IsNotEmpty({ each: true })
  	TINs: string[]

	@IsOptional()
	@IsEnum(Role)
  	role?: Role
}

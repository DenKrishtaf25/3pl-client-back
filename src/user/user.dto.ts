import {
	IsEmail,
	IsOptional,
	IsString,
	MinLength,
	IsArray,
	IsNotEmpty
} from 'class-validator'
import { Role } from '@prisma/client'


export class UserDto {
	@IsEmail()
	@IsOptional()
	email?: string

	@IsString()
	@IsOptional()
	name?: string

	@IsOptional()
	@MinLength(6, {
		message: 'Password must be at least 6 characters long'
	})
	@IsString()
	password?: string

	@IsArray()
  	@IsNotEmpty({ each: true })
  	TINs: string[]

	@IsOptional()
  	role?: Role
}

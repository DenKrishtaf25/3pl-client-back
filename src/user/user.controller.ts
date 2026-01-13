import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	Param,
	Post,
	Put,
	UseGuards,
	UsePipes,
	ValidationPipe
} from '@nestjs/common'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/user.decorator'
import { UserDto } from './user.dto'
import { UserService } from './user.service'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt.guard'
import { RolesGuard } from '../auth/guards/roles.guard'

@Controller('user/profile')
export class UserController {
	constructor(private readonly userService: UserService) {}

	@Get()
	@Auth()
	async profile(@CurrentUser('id') id: string) {
		return this.userService.getProfile(id)
	}

	@UsePipes(new ValidationPipe())
	@HttpCode(200)
	@Put()
	@Auth()
	async updateProfile(@CurrentUser('id') id: string, @Body() dto: UserDto) {
		return this.userService.update(id, dto)
	}
}

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminUsersController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @Roles('ADMIN')
  async findAll() {
    return this.userService.findAll()
  }

  @Post()
  @Roles('ADMIN')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async create(@Body() dto: UserDto) {
    return this.userService.create(dto)
  }

  @Put(':id')
  @Roles('ADMIN')
  async update(@Param('id') id: string, @Body() dto: UserDto) {
    return this.userService.fullUpdate(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id') id: string) {
    return this.userService.remove(id);
  }
}


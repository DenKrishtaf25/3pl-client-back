import { Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common'
import { AnalyticOrderService } from './analytic-order.service'
import { FindAnalyticOrderDto } from './analytic-order.dto'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/user.decorator'

@Controller('analytic-orders')
export class AnalyticOrderController {
  constructor(private readonly analyticOrderService: AnalyticOrderService) {}

  @Get('chart')
  @Auth()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getChartData(
    @Query() query: FindAnalyticOrderDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string
  ) {
    return this.analyticOrderService.getChartData(query, userId, userRole)
  }

  @Get('meta/last-import')
  @Auth()
  async getLastImportInfo() {
    return this.analyticOrderService.getLastImportInfo()
  }
}


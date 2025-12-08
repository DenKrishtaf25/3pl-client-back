import { Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'
import { FindAnalyticsDto } from './analytics.dto'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/user.decorator'

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('chart')
  @Auth()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getChartData(
    @Query() query: FindAnalyticsDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string
  ) {
    return this.analyticsService.getChartData(query, userId, userRole)
  }

  @Get('meta/last-import')
  @Auth()
  async getLastImportInfo() {
    return this.analyticsService.getLastImportInfo()
  }
}


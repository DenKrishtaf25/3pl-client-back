import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { AuthModule } from './auth/auth.module'
import { UserModule } from './user/user.module'
import { ClientModule } from './client/client.module'
import { StockModule } from './stock/stock.module'
import { RegistryModule } from './registry/registry.module'
import { OrderModule } from './order/order.module'
import { AnalyticsModule } from './analytics/analytics.module'
import { AnalyticOrderModule } from './analytic-order/analytic-order.module'
import { FinanceModule } from './finance/finance.module'
import { ComplaintsModule } from './complaints/complaints.module'
import { SchedulerModule } from './scheduler/scheduler.module'

@Module({
  imports: [
    ConfigModule.forRoot(),
    // Настройка Rate Limiting
    // По умолчанию: 100 запросов в минуту с одного IP
    ThrottlerModule.forRoot([{
      ttl: 60000, // 1 минута (в миллисекундах)
      limit: 100, // максимум 100 запросов за период ttl
    }]),
		AuthModule,
    UserModule,
    ClientModule,
    StockModule,
    RegistryModule,
    OrderModule,
    AnalyticsModule,
    AnalyticOrderModule,
    FinanceModule,
    ComplaintsModule,
    SchedulerModule,
  ],
  providers: [
    // Глобальный guard для применения rate limiting ко всем эндпоинтам
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

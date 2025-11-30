import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from './auth/auth.module'
import { UserModule } from './user/user.module'
import { ClientModule } from './client/client.module'
import { StockModule } from './stock/stock.module'
import { RegistryModule } from './registry/registry.module'
import { OrderModule } from './order/order.module'

@Module({
  imports: [
    ConfigModule.forRoot(),
		AuthModule,
    UserModule,
    ClientModule,
    StockModule,
    RegistryModule,
    OrderModule,
  ],
})
export class AppModule {}

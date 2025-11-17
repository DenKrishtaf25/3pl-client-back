import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from './auth/auth.module'
import { UserModule } from './user/user.module'
import { ClientModule } from './client/client.module'
import { StockModule } from './stock/stock.module'
import { RegistryModule } from './registry/registry.module'

@Module({
  imports: [
    ConfigModule.forRoot(),
		AuthModule,
    UserModule,
    ClientModule,
    StockModule,
    RegistryModule,
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common'
import { RegistryService } from './registry.service'
import { UserRegistryController, AdminRegistryController } from './registry.controller'
import { PrismaService } from 'src/prisma.service'

@Module({
  controllers: [UserRegistryController, AdminRegistryController],
  providers: [RegistryService, PrismaService]
})
export class RegistryModule {}


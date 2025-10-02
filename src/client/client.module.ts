import { Module } from '@nestjs/common'
import { ClientService } from './client.service'
import { AdminClientsController } from './client.controller'
import { PrismaService } from 'src/prisma.service'

@Module({
  controllers: [AdminClientsController],
  providers: [ClientService, PrismaService]
})
export class ClientModule {}

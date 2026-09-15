import { Module } from '@nestjs/common';
import { ProviderConnectionsController } from './provider-connections.controller';
import { ProviderConnectionsService } from './provider-connections.service';

@Module({
  controllers: [ProviderConnectionsController],
  providers: [ProviderConnectionsService],
})
export class ProvidersModule {}

import { Module } from '@nestjs/common';
import { MockPayAdapter } from './mockpay.adapter';
import { ProviderAdapterRegistry } from './provider-adapter.registry';
import { ProviderConnectionsController } from './provider-connections.controller';
import { ProviderConnectionsService } from './provider-connections.service';

@Module({
  controllers: [ProviderConnectionsController],
  providers: [MockPayAdapter, ProviderAdapterRegistry, ProviderConnectionsService],
  exports: [ProviderAdapterRegistry],
})
export class ProvidersModule {}

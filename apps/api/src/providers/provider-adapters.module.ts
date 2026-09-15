import { Module } from '@nestjs/common';
import { MockPayAdapter } from './mockpay.adapter';
import { ProviderAdapterRegistry } from './provider-adapter.registry';

/** Provider-specific webhook handling, shared by ingestion (API) and processing (worker). */
@Module({
  providers: [MockPayAdapter, ProviderAdapterRegistry],
  exports: [ProviderAdapterRegistry],
})
export class ProviderAdaptersModule {}

import { Module } from '@nestjs/common';
import { DeliveryScheduler } from '../deliveries/delivery-scheduler';
import { LedgerWriter } from '../ledger/ledger-writer';
import { ProviderAdaptersModule } from '../providers/provider-adapters.module';
import { EventProcessor } from './event-processor';

@Module({
  imports: [ProviderAdaptersModule],
  providers: [EventProcessor, LedgerWriter, DeliveryScheduler],
  exports: [EventProcessor],
})
export class ProcessingModule {}

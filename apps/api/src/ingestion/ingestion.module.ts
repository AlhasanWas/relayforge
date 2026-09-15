import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { ProviderAdaptersModule } from '../providers/provider-adapters.module';
import { RejectedAttemptRecorder } from './rejected-attempt.recorder';
import { RejectedAttemptsController } from './rejected-attempts.controller';
import { RejectedAttemptsService } from './rejected-attempts.service';
import { WebhookIngestionController } from './webhook-ingestion.controller';
import { WebhookIngestionService } from './webhook-ingestion.service';

@Module({
  imports: [ProviderAdaptersModule, OutboxModule],
  controllers: [WebhookIngestionController, RejectedAttemptsController],
  providers: [WebhookIngestionService, RejectedAttemptRecorder, RejectedAttemptsService],
})
export class IngestionModule {}

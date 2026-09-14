import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { ProvidersModule } from '../providers/providers.module';
import { RejectedAttemptRecorder } from './rejected-attempt.recorder';
import { RejectedAttemptsController } from './rejected-attempts.controller';
import { RejectedAttemptsService } from './rejected-attempts.service';
import { WebhookIngestionController } from './webhook-ingestion.controller';
import { WebhookIngestionService } from './webhook-ingestion.service';

@Module({
  imports: [ProvidersModule, OutboxModule],
  controllers: [WebhookIngestionController, RejectedAttemptsController],
  providers: [WebhookIngestionService, RejectedAttemptRecorder, RejectedAttemptsService],
})
export class IngestionModule {}

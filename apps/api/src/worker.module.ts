import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { OutboxPublisher } from './outbox/outbox-publisher';
import { OutboxPublisherRunner } from './outbox/outbox-publisher.runner';
import { EventProcessingConsumer } from './processing/event-processing.consumer';
import { ProcessingModule } from './processing/processing.module';
import { QueueModule } from './queue/queue.module';
import { WorkerIdentity } from './worker/worker-identity';

/**
 * The worker process: publishes the outbox and consumes queues. It serves no HTTP,
 * so a slow customer endpoint can never consume ingestion capacity.
 */
@Module({
  imports: [CoreModule, QueueModule, ProcessingModule],
  providers: [WorkerIdentity, OutboxPublisher, OutboxPublisherRunner, EventProcessingConsumer],
})
export class WorkerModule {}

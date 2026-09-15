import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { DeliveryAttemptRunner } from './deliveries/delivery-attempt.runner';
import { deliveryRetryPolicyProvider } from './deliveries/delivery-retry-policy.provider';
import { DeliveryConsumer } from './deliveries/delivery.consumer';
import { RecoverySweeper } from './maintenance/recovery-sweeper';
import { RecoverySweeperRunner } from './maintenance/recovery-sweeper.runner';
import { OutboxModule } from './outbox/outbox.module';
import { OutboxPublisher } from './outbox/outbox-publisher';
import { OutboxPublisherRunner } from './outbox/outbox-publisher.runner';
import { EventProcessingConsumer } from './processing/event-processing.consumer';
import { ProcessingModule } from './processing/processing.module';
import { QueueModule } from './queue/queue.module';
import { WorkerIdentity } from './worker/worker-identity';

/**
 * The worker process: publishes the outbox, consumes queues and runs recovery. It
 * serves no HTTP, so a slow customer endpoint can never consume ingestion capacity.
 */
@Module({
  imports: [CoreModule, QueueModule, OutboxModule, ProcessingModule],
  providers: [
    WorkerIdentity,
    OutboxPublisher,
    OutboxPublisherRunner,
    EventProcessingConsumer,
    deliveryRetryPolicyProvider,
    DeliveryAttemptRunner,
    DeliveryConsumer,
    RecoverySweeper,
    RecoverySweeperRunner,
  ],
})
export class WorkerModule {}

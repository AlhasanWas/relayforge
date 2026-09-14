import { Module } from '@nestjs/common';
import { OutboxWriter } from './outbox-writer';

@Module({
  providers: [OutboxWriter],
  exports: [OutboxWriter],
})
export class OutboxModule {}

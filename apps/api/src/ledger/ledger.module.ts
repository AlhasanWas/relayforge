import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller';
import { LedgerQueryService } from './ledger-query.service';

/** Read-side ledger API. Journals are written only by event processing (LedgerWriter). */
@Module({
  controllers: [LedgerController],
  providers: [LedgerQueryService],
})
export class LedgerModule {}

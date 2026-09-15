import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { ApiKeyAuthGuard } from './auth/api-key-auth.guard';
import { AuthModule } from './auth/auth.module';
import { CoreModule } from './core/core.module';
import { EndpointsModule } from './endpoints/endpoints.module';
import { GlobalExceptionFilter } from './errors/global-exception.filter';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { LedgerModule } from './ledger/ledger.module';
import { ProvidersModule } from './providers/providers.module';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { TransactionsModule } from './transactions/transactions.module';

/** The HTTP API process. Queue consumers run in the separate worker process. */
@Module({
  imports: [
    CoreModule,
    AuthModule,
    RateLimitModule,
    HealthModule,
    ApiKeysModule,
    ProvidersModule,
    IngestionModule,
    EventsModule,
    EndpointsModule,
    TransactionsModule,
    LedgerModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    // Global guards run in the order listed: authenticate first, then rate limit
    // per authenticated key.
    { provide: APP_GUARD, useExisting: ApiKeyAuthGuard },
    { provide: APP_GUARD, useExisting: RateLimitGuard },
  ],
})
export class AppModule {}

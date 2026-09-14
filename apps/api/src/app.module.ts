import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AuditModule } from './audit/audit.module';
import { ApiKeyAuthGuard } from './auth/api-key-auth.guard';
import { AuthModule } from './auth/auth.module';
import { ClockModule } from './clock/clock.module';
import { ConfigModule } from './config/config.module';
import { CryptoModule } from './crypto/crypto.module';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { GlobalExceptionFilter } from './errors/global-exception.filter';
import { HealthModule } from './health/health.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { LoggingModule } from './logging/logging.module';
import { ProvidersModule } from './providers/providers.module';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    ClockModule,
    DatabaseModule,
    RedisModule,
    CryptoModule,
    AuditModule,
    AuthModule,
    RateLimitModule,
    HealthModule,
    ApiKeysModule,
    ProvidersModule,
    IngestionModule,
    EventsModule,
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

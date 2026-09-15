import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ClockModule } from '../clock/clock.module';
import { ConfigModule } from '../config/config.module';
import { CryptoModule } from '../crypto/crypto.module';
import { DatabaseModule } from '../database/database.module';
import { LoggingModule } from '../logging/logging.module';
import { RedisModule } from '../redis/redis.module';

/** Infrastructure shared by the HTTP API process and the worker process. */
@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    ClockModule,
    DatabaseModule,
    RedisModule,
    CryptoModule,
    AuditModule,
  ],
  exports: [
    ConfigModule,
    LoggingModule,
    ClockModule,
    DatabaseModule,
    RedisModule,
    CryptoModule,
    AuditModule,
  ],
})
export class CoreModule {}

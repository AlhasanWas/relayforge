import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { GlobalExceptionFilter } from './errors/global-exception.filter';
import { HealthModule } from './health/health.module';
import { LoggingModule } from './logging/logging.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [ConfigModule, LoggingModule, DatabaseModule, RedisModule, HealthModule],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}

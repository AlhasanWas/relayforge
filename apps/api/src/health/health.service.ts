import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { withTimeout } from '../common/with-timeout';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { REDIS } from '../redis/redis.module';

export type DependencyStatus = 'up' | 'down';

export interface DependencyHealth {
  status: DependencyStatus;
  durationMs: number;
}

export interface ReadinessReport {
  status: 'ok' | 'unavailable';
  checks: {
    database: DependencyHealth;
    redis: DependencyHealth;
  };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(HealthService.name);
  }

  async checkReadiness(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([
      this.probe('database', async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }),
      this.probe('redis', async () => {
        await this.redis.ping();
      }),
    ]);
    const status = database.status === 'up' && redis.status === 'up' ? 'ok' : 'unavailable';
    return { status, checks: { database, redis } };
  }

  private async probe(name: string, check: () => Promise<void>): Promise<DependencyHealth> {
    const startedAt = performance.now();
    try {
      await withTimeout(check(), this.config.health.checkTimeoutMs, `${name} readiness check`);
      return { status: 'up', durationMs: elapsedSince(startedAt) };
    } catch (error: unknown) {
      const durationMs = elapsedSince(startedAt);
      // Failure details stay in logs; the public report only says "down".
      this.logger.warn({ err: error, dependency: name, durationMs }, 'Readiness check failed');
      return { status: 'down', durationMs };
    }
  }
}

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

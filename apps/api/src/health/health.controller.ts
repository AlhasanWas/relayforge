import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { HealthService, type ReadinessReport } from './health.service';

/** Probes for orchestrators: unauthenticated, never rate limited. */
@Public()
@SkipThrottle()
@ApiExcludeController()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly health: HealthService) {}

  /** Summary for operators: readiness checks plus process uptime. */
  @Get()
  async summary(
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReadinessReport & { uptimeSeconds: number }> {
    const report = await this.health.checkReadiness();
    response.status(statusCodeFor(report));
    return { ...report, uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000) };
  }

  /** Liveness: the process is running and serving HTTP. Never checks dependencies. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: PostgreSQL and Redis are reachable. 503 removes the instance from rotation. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessReport> {
    const report = await this.health.checkReadiness();
    response.status(statusCodeFor(report));
    return report;
  }
}

function statusCodeFor(report: ReadinessReport): HttpStatus {
  return report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
}

import { Injectable } from '@nestjs/common';
import { Clock } from '../clock/clock';
import { PrismaService } from '../database/prisma.service';

export interface MetricsOverview {
  window: { from: string; to: string; hours: number };
  events: { received: number; processed: number; failed: number; ignored: number };
  rejectedWebhooks: number;
  deliveries: {
    succeeded: number;
    failedAttempts: number;
    /** Current dead-letter backlog, not limited to the window. */
    deadLetter: number;
    /** Current PENDING and PROCESSING deliveries, not limited to the window. */
    inProgress: number;
  };
  /** Measured HTTP round trip of delivery attempts in the window; null without data. */
  deliveryLatencyMs: { average: number | null; p95: number | null; sampleSize: number };
}

interface MetricsRow {
  received: bigint;
  processed: bigint;
  failed: bigint;
  ignored: bigint;
  rejected: bigint;
  succeeded: bigint;
  failedAttempts: bigint;
  deadLetter: bigint;
  inProgress: bigint;
  latencySamples: bigint;
  averageLatency: number | null;
  p95Latency: number | null;
}

/**
 * Operational metrics computed with SQL aggregates over real rows. Nothing is
 * sampled, estimated or cached; every figure can be reproduced with a query.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async overview(workspaceId: string, windowHours: number): Promise<MetricsOverview> {
    const to = this.clock.now();
    const from = new Date(to.getTime() - windowHours * 3_600_000);

    const [row] = await this.prisma.$queryRaw<MetricsRow[]>`
      SELECT
        (SELECT count(*) FROM incoming_events
          WHERE workspace_id = ${workspaceId}::uuid AND received_at >= ${from} AND received_at < ${to}) AS received,
        (SELECT count(*) FROM incoming_events
          WHERE workspace_id = ${workspaceId}::uuid AND status = 'PROCESSED'
            AND processed_at >= ${from} AND processed_at < ${to}) AS processed,
        (SELECT count(*) FROM incoming_events
          WHERE workspace_id = ${workspaceId}::uuid AND status = 'FAILED'
            AND processed_at >= ${from} AND processed_at < ${to}) AS failed,
        (SELECT count(*) FROM incoming_events
          WHERE workspace_id = ${workspaceId}::uuid AND status = 'IGNORED'
            AND processed_at >= ${from} AND processed_at < ${to}) AS ignored,
        (SELECT count(*) FROM rejected_webhook_attempts
          WHERE workspace_id = ${workspaceId}::uuid AND received_at >= ${from} AND received_at < ${to}) AS rejected,
        (SELECT count(*) FROM webhook_deliveries
          WHERE workspace_id = ${workspaceId}::uuid AND status = 'SUCCEEDED'
            AND delivered_at >= ${from} AND delivered_at < ${to}) AS succeeded,
        (SELECT count(*) FROM delivery_attempts AS attempt
           JOIN webhook_deliveries AS delivery ON delivery.id = attempt.delivery_id
          WHERE delivery.workspace_id = ${workspaceId}::uuid AND attempt.outcome <> 'SUCCESS'
            AND attempt.recorded_at >= ${from} AND attempt.recorded_at < ${to}) AS "failedAttempts",
        (SELECT count(*) FROM webhook_deliveries
          WHERE workspace_id = ${workspaceId}::uuid AND status = 'DEAD_LETTER') AS "deadLetter",
        (SELECT count(*) FROM webhook_deliveries
          WHERE workspace_id = ${workspaceId}::uuid AND status IN ('PENDING', 'PROCESSING')) AS "inProgress",
        latency.samples AS "latencySamples",
        latency.average AS "averageLatency",
        latency.p95 AS "p95Latency"
      FROM (
        SELECT count(attempt.duration_ms) AS samples,
               round(avg(attempt.duration_ms))::float8 AS average,
               round(percentile_cont(0.95) WITHIN GROUP (ORDER BY attempt.duration_ms))::float8 AS p95
          FROM delivery_attempts AS attempt
          JOIN webhook_deliveries AS delivery ON delivery.id = attempt.delivery_id
         WHERE delivery.workspace_id = ${workspaceId}::uuid
           AND attempt.duration_ms IS NOT NULL
           AND attempt.recorded_at >= ${from} AND attempt.recorded_at < ${to}
      ) AS latency`;

    if (row === undefined) {
      throw new Error('Metrics query returned no row');
    }
    return {
      window: { from: from.toISOString(), to: to.toISOString(), hours: windowHours },
      events: {
        received: Number(row.received),
        processed: Number(row.processed),
        failed: Number(row.failed),
        ignored: Number(row.ignored),
      },
      rejectedWebhooks: Number(row.rejected),
      deliveries: {
        succeeded: Number(row.succeeded),
        failedAttempts: Number(row.failedAttempts),
        deadLetter: Number(row.deadLetter),
        inProgress: Number(row.inProgress),
      },
      deliveryLatencyMs: {
        average: row.averageLatency,
        p95: row.p95Latency,
        sampleSize: Number(row.latencySamples),
      },
    };
  }
}

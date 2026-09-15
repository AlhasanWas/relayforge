import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

/**
 * Identifies this process as a lease owner (outbox rows, deliveries). Unique per
 * process start, and readable in the database when diagnosing stuck work.
 */
export class WorkerIdentity {
  readonly id = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

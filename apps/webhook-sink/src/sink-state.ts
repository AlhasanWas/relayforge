import type { SinkMode } from './sink-mode';

export interface ReceivedWebhook {
  receivedAt: string;
  path: string;
  webhookId: string | null;
  deliveryId: string | null;
  attempt: string | null;
  /** True when this webhook-id was already received: what a receiver should deduplicate. */
  duplicate: boolean;
  bodyBytes: number;
  outcome: number | 'TIMEOUT';
}

const MAX_RECENT = 200;
const MAX_REMEMBERED_IDS = 10_000;

/** In-memory sink state. Deliberately not persisted: restart the sink to reset it. */
export class SinkState {
  private readonly recent: ReceivedWebhook[] = [];
  private readonly seenIds = new Set<string>();

  constructor(
    public mode: SinkMode,
    public failureRate: number,
  ) {}

  /** Records a webhook and reports whether its id was seen before. */
  remember(webhookId: string | null): boolean {
    if (webhookId === null) return false;
    const duplicate = this.seenIds.has(webhookId);
    this.seenIds.add(webhookId);
    if (this.seenIds.size > MAX_REMEMBERED_IDS) {
      const oldest = this.seenIds.values().next().value;
      if (oldest !== undefined) this.seenIds.delete(oldest);
    }
    return duplicate;
  }

  record(webhook: ReceivedWebhook): void {
    this.recent.unshift(webhook);
    this.recent.length = Math.min(this.recent.length, MAX_RECENT);
  }

  received(limit: number): ReceivedWebhook[] {
    return this.recent.slice(0, limit);
  }
}

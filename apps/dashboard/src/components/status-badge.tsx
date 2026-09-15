import { humanize } from '@/lib/format';

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'idle';

const TONES: Readonly<Record<string, Tone>> = {
  // Events
  RECEIVED: 'info',
  PROCESSED: 'ok',
  IGNORED: 'idle',
  FAILED: 'bad',
  // Deliveries
  PENDING: 'warn',
  PROCESSING: 'info',
  SUCCEEDED: 'ok',
  DEAD_LETTER: 'bad',
  // Attempts
  SUCCESS: 'ok',
  RETRYABLE_FAILURE: 'warn',
  PERMANENT_FAILURE: 'bad',
  UNKNOWN: 'idle',
  // Transactions
  PARTIALLY_REFUNDED: 'warn',
  REFUNDED: 'idle',
};

const CLASSES: Readonly<Record<Tone, string>> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
  idle: 'bg-idle-soft text-idle',
};

export function Badge({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={TONES[status] ?? 'idle'}>{humanize(status)}</Badge>;
}

import Link from 'next/link';
import { Badge, StatusBadge } from '@/components/status-badge';
import { Cell, Table } from '@/components/table';
import { Card, EmptyState, Mono, PageHeader, Section, Stat, TextLink } from '@/components/ui';
import {
  getMetricsOverview,
  listDeliveries,
  listEvents,
  listProviderConnections,
} from '@/lib/api/resources';
import { formatDateTime, formatDuration, humanize } from '@/lib/format';
import { hrefWith, type SearchParams } from '@/lib/search-params';

const WINDOWS = [
  { hours: 1, label: '1 h' },
  { hours: 24, label: '24 h' },
  { hours: 168, label: '7 d' },
] as const;

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const selected = WINDOWS.find((option) => String(option.hours) === params.window) ?? WINDOWS[1];

  const [metrics, connections, recentEvents, deadLetters] = await Promise.all([
    getMetricsOverview(selected.hours),
    listProviderConnections(),
    listEvents({ limit: 8 }),
    listDeliveries({ status: 'DEAD_LETTER', limit: 5 }),
  ]);

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Activity from ${formatDateTime(metrics.window.from)} to ${formatDateTime(metrics.window.to)}.`}
        actions={
          <nav
            aria-label="Time window"
            className="border-line bg-surface flex gap-1 rounded-lg border p-1"
          >
            {WINDOWS.map((option) => (
              <Link
                key={option.hours}
                href={hrefWith('/', { window: String(option.hours) })}
                aria-current={option.hours === selected.hours ? 'true' : undefined}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  option.hours === selected.hours
                    ? 'bg-subtle font-medium'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {option.label}
              </Link>
            ))}
          </nav>
        }
      />

      <Section title="Incoming webhooks">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Received" value={metrics.events.received} />
          <Stat label="Processed" value={metrics.events.processed} />
          <Stat label="Ignored" value={metrics.events.ignored} hint="Unknown event types" />
          <Stat label="Failed" value={metrics.events.failed} />
          <Stat label="Rejected" value={metrics.rejectedWebhooks} hint="Bad signature or payload" />
        </div>
      </Section>

      <Section title="Outgoing deliveries">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Succeeded" value={metrics.deliveries.succeeded} />
          <Stat
            label="Failed attempts"
            value={metrics.deliveries.failedAttempts}
            hint="Includes retried attempts"
          />
          <Stat label="In progress" value={metrics.deliveries.inProgress} hint="All time" />
          <Stat label="Dead letter" value={metrics.deliveries.deadLetter} hint="All time" />
          <Stat
            label="Attempt latency"
            value={formatDuration(metrics.deliveryLatencyMs.average)}
            hint={`p95 ${formatDuration(metrics.deliveryLatencyMs.p95)} · ${metrics.deliveryLatencyMs.sampleSize} attempts`}
          />
        </div>
      </Section>

      <Section
        title="Provider connections"
        description="Providers send signed webhooks to these ingress paths. The ingress key routes requests; it is not a secret."
      >
        {connections.data.length === 0 ? (
          <EmptyState>No provider connections. Run the seed to create the MockPay demo.</EmptyState>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {connections.data.map((connection) => (
              <Card key={connection.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{connection.name}</p>
                  <Badge tone={connection.enabled ? 'ok' : 'idle'}>
                    {connection.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
                <p className="text-muted mt-0.5 text-xs">{connection.provider.displayName}</p>
                <p className="mt-2 break-all">
                  <Mono>POST {connection.ingressPath}</Mono>
                </p>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Recent events" actions={<TextLink href="/events">All events →</TextLink>}>
        {recentEvents.data.length === 0 ? (
          <EmptyState>No events yet. Send one with pnpm demo:event.</EmptyState>
        ) : (
          <Table caption="Recent events" head={['Received', 'Type', 'Provider event', 'Status']}>
            {recentEvents.data.map((event) => (
              <tr key={event.id}>
                <Cell className="whitespace-nowrap">
                  <TextLink href={`/events/${event.id}`}>
                    {formatDateTime(event.receivedAt)}
                  </TextLink>
                </Cell>
                <Cell>
                  <Mono>{event.eventType}</Mono>
                </Cell>
                <Cell>
                  <Mono>{event.externalEventId}</Mono>
                </Cell>
                <Cell>
                  <StatusBadge status={event.status} />
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section
        title="Latest dead letters"
        actions={<TextLink href="/dead-letter">Dead letter queue →</TextLink>}
      >
        {deadLetters.data.length === 0 ? (
          <EmptyState>No dead-lettered deliveries.</EmptyState>
        ) : (
          <Table caption="Latest dead letters" head={['Dead-lettered', 'Reason', 'Attempts']}>
            {deadLetters.data.map((delivery) => (
              <tr key={delivery.id}>
                <Cell className="whitespace-nowrap">
                  <TextLink href={`/deliveries/${delivery.id}`}>
                    {formatDateTime(delivery.deadLetteredAt)}
                  </TextLink>
                </Cell>
                <Cell>
                  {delivery.deadLetterReason === null ? '—' : humanize(delivery.deadLetterReason)}
                </Cell>
                <Cell className="tabular-nums">
                  {delivery.attemptCount} / {delivery.maxAttempts}
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </>
  );
}

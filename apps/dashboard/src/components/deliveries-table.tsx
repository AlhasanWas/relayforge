import { ReplayButton } from '@/components/forms';
import { StatusBadge } from '@/components/status-badge';
import { Cell, Table } from '@/components/table';
import { Mono, TextLink } from '@/components/ui';
import type { DeliverySummary } from '@/lib/api/schemas';
import { formatDateTime, humanize, shortId } from '@/lib/format';

const REPLAYABLE = new Set(['SUCCEEDED', 'DEAD_LETTER']);

export function EndpointLabel({
  endpointId,
  endpointUrls,
}: {
  endpointId: string;
  endpointUrls: ReadonlyMap<string, string>;
}) {
  const url = endpointUrls.get(endpointId);
  return url === undefined ? (
    <Mono title={endpointId}>{shortId(endpointId)}</Mono>
  ) : (
    <Mono title={endpointId}>{url}</Mono>
  );
}

export function DeliveriesTable({
  deliveries,
  endpointUrls,
  variant = 'default',
}: {
  deliveries: readonly DeliverySummary[];
  endpointUrls: ReadonlyMap<string, string>;
  variant?: 'default' | 'dead-letter';
}) {
  const deadLetter = variant === 'dead-letter';
  const head = deadLetter
    ? ['Dead-lettered', 'Endpoint', 'Reason', 'Attempts', 'Event', '']
    : ['Created', 'Endpoint', 'Status', 'Attempts', 'Next attempt', 'Event', ''];

  return (
    <Table caption={deadLetter ? 'Dead-lettered deliveries' : 'Deliveries'} head={head}>
      {deliveries.map((delivery) => (
        <tr key={delivery.id}>
          <Cell className="whitespace-nowrap">
            <TextLink href={`/deliveries/${delivery.id}`}>
              {formatDateTime(deadLetter ? delivery.deadLetteredAt : delivery.createdAt)}
            </TextLink>
            {delivery.replayOfDeliveryId !== null && (
              <p className="text-muted mt-0.5 text-xs">Replay</p>
            )}
          </Cell>
          <Cell className="max-w-64 break-all">
            <EndpointLabel endpointId={delivery.endpointId} endpointUrls={endpointUrls} />
          </Cell>
          <Cell>
            {deadLetter ? (
              delivery.deadLetterReason === null ? (
                '—'
              ) : (
                humanize(delivery.deadLetterReason)
              )
            ) : (
              <StatusBadge status={delivery.status} />
            )}
          </Cell>
          <Cell className="tabular-nums whitespace-nowrap">
            {delivery.attemptCount} / {delivery.maxAttempts}
          </Cell>
          {!deadLetter && (
            <Cell className="whitespace-nowrap">{formatDateTime(delivery.nextAttemptAt)}</Cell>
          )}
          <Cell>
            <TextLink href={`/events/${delivery.eventId}`}>
              <Mono title={delivery.eventId}>{shortId(delivery.eventId)}</Mono>
            </TextLink>
          </Cell>
          <Cell>
            {REPLAYABLE.has(delivery.status) && <ReplayButton deliveryId={delivery.id} />}
          </Cell>
        </tr>
      ))}
    </Table>
  );
}

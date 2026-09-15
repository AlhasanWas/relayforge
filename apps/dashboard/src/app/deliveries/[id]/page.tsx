import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EndpointLabel } from '@/components/deliveries-table';
import { ReplayButton } from '@/components/forms';
import { StatusBadge } from '@/components/status-badge';
import { Cell, Table } from '@/components/table';
import {
  DetailList,
  EmptyState,
  JsonBlock,
  Mono,
  Notice,
  PageHeader,
  Section,
  TextLink,
} from '@/components/ui';
import { orNotFound } from '@/lib/api/errors';
import { getDelivery, getEndpointUrls } from '@/lib/api/resources';
import type { DeliveryAttempt } from '@/lib/api/schemas';
import { formatDateTime, formatDuration, humanize } from '@/lib/format';
import { isUuid } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Delivery' };

function attemptResult(attempt: DeliveryAttempt): string {
  if (attempt.responseStatus !== null) return `HTTP ${attempt.responseStatus}`;
  return attempt.errorCode === null ? '—' : humanize(attempt.errorCode);
}

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [delivery, endpointUrls] = await Promise.all([
    orNotFound(getDelivery(id)),
    getEndpointUrls(),
  ]);
  const replayable = delivery.status === 'SUCCEEDED' || delivery.status === 'DEAD_LETTER';
  const hasUnknownAttempt = delivery.attempts.some((attempt) => attempt.outcome === 'UNKNOWN');

  return (
    <>
      <PageHeader
        title="Delivery"
        description={<Mono>{delivery.id}</Mono>}
        actions={
          <div className="flex items-start gap-3">
            <StatusBadge status={delivery.status} />
            {replayable && <ReplayButton deliveryId={delivery.id} />}
          </div>
        }
      />

      <DetailList
        items={[
          ['Status', <StatusBadge key="status" status={delivery.status} />],
          [
            'Endpoint',
            <EndpointLabel
              key="endpoint"
              endpointId={delivery.endpointId}
              endpointUrls={endpointUrls}
            />,
          ],
          [
            'Event (webhook-id)',
            <TextLink key="event" href={`/events/${delivery.eventId}`}>
              <Mono>{delivery.eventId}</Mono>
            </TextLink>,
          ],
          [
            'Replay of',
            delivery.replayOfDeliveryId === null ? (
              '—'
            ) : (
              <TextLink key="original" href={`/deliveries/${delivery.replayOfDeliveryId}`}>
                <Mono>{delivery.replayOfDeliveryId}</Mono>
              </TextLink>
            ),
          ],
          ['Attempts', `${delivery.attemptCount} of ${delivery.maxAttempts}`],
          ['Next attempt', formatDateTime(delivery.nextAttemptAt)],
          ['Delivered', formatDateTime(delivery.deliveredAt)],
          ['Dead-lettered', formatDateTime(delivery.deadLetteredAt)],
          [
            'Dead letter reason',
            delivery.deadLetterReason === null ? '—' : humanize(delivery.deadLetterReason),
          ],
          ['Created', formatDateTime(delivery.createdAt)],
        ]}
      />

      <Section
        title="Attempts"
        description="One immutable record per attempt number, as observed by the worker."
      >
        {hasUnknownAttempt && (
          <div className="mb-3">
            <Notice tone="warn">
              An Unknown attempt means the worker lost its lease before recording a result. The
              receiver may or may not have received that request.
            </Notice>
          </div>
        )}
        {delivery.attempts.length === 0 ? (
          <EmptyState>No attempts yet.</EmptyState>
        ) : (
          <Table
            caption="Delivery attempts"
            head={['#', 'Outcome', 'Result', 'Duration', 'Recorded', 'Detail']}
          >
            {delivery.attempts.map((attempt) => (
              <tr key={attempt.attemptNumber}>
                <Cell className="tabular-nums">{attempt.attemptNumber}</Cell>
                <Cell>
                  <StatusBadge status={attempt.outcome} />
                </Cell>
                <Cell className="whitespace-nowrap">{attemptResult(attempt)}</Cell>
                <Cell className="tabular-nums whitespace-nowrap">
                  {formatDuration(attempt.durationMs)}
                </Cell>
                <Cell className="whitespace-nowrap">{formatDateTime(attempt.recordedAt)}</Cell>
                <Cell className="text-muted max-w-96">
                  {attempt.errorMessage !== null && <p>{attempt.errorMessage}</p>}
                  {attempt.responseBody !== null && attempt.responseBody !== '' && (
                    <details>
                      <summary className="cursor-pointer text-xs">Response body</summary>
                      <pre className="mt-1 font-mono text-xs break-all whitespace-pre-wrap">
                        {attempt.responseBody}
                      </pre>
                    </details>
                  )}
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section
        title="Payload"
        description="The JSON body signed and sent on every attempt (shown formatted)."
      >
        <JsonBlock value={delivery.payload} />
      </Section>
    </>
  );
}

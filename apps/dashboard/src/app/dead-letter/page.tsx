import type { Metadata } from 'next';
import { DeliveriesTable } from '@/components/deliveries-table';
import { Pagination } from '@/components/list-controls';
import { EmptyState, PageHeader } from '@/components/ui';
import { getEndpointUrls, listDeliveries } from '@/lib/api/resources';
import { type SearchParams, uuidParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Dead letter' };

export default async function DeadLetterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const cursor = uuidParam(await searchParams, 'cursor');
  const [deliveries, endpointUrls] = await Promise.all([
    listDeliveries({ status: 'DEAD_LETTER', cursor }),
    getEndpointUrls(),
  ]);

  return (
    <>
      <PageHeader
        title="Dead letter"
        description="Deliveries that stopped retrying: a non-retryable response, an unavailable endpoint, or an exhausted retry budget. Replaying creates a new delivery with the same webhook-id; the original and its attempts stay unchanged."
      />
      {deliveries.data.length === 0 ? (
        <EmptyState>The dead letter queue is empty.</EmptyState>
      ) : (
        <DeliveriesTable
          deliveries={deliveries.data}
          endpointUrls={endpointUrls}
          variant="dead-letter"
        />
      )}
      <Pagination
        pathname="/dead-letter"
        filters={{}}
        cursor={cursor}
        nextCursor={deliveries.nextCursor}
      />
    </>
  );
}

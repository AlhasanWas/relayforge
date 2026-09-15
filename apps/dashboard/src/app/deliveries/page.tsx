import type { Metadata } from 'next';
import { DeliveriesTable, EndpointLabel } from '@/components/deliveries-table';
import { FilterTabs, Pagination } from '@/components/list-controls';
import { EmptyState, PageHeader, TextLink } from '@/components/ui';
import { getEndpointUrls, listDeliveries } from '@/lib/api/resources';
import { DELIVERY_STATUSES } from '@/lib/api/schemas';
import { enumParam, hrefWith, type SearchParams, uuidParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Deliveries' };

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const status = enumParam(params, 'status', DELIVERY_STATUSES);
  const endpointId = uuidParam(params, 'endpointId');
  const cursor = uuidParam(params, 'cursor');
  const [deliveries, endpointUrls] = await Promise.all([
    listDeliveries({ status, endpointId, cursor }),
    getEndpointUrls(),
  ]);

  return (
    <>
      <PageHeader
        title="Deliveries"
        description="Signed webhooks sent to your endpoints. Delivery is at least once: receivers should deduplicate on the webhook-id header."
      />
      {endpointId !== undefined && (
        <p className="text-muted mb-3 text-sm">
          Endpoint <EndpointLabel endpointId={endpointId} endpointUrls={endpointUrls} /> ·{' '}
          <TextLink href={hrefWith('/deliveries', { status })}>Show all endpoints</TextLink>
        </p>
      )}
      <FilterTabs
        pathname="/deliveries"
        param="status"
        values={DELIVERY_STATUSES}
        current={status}
        keep={{ endpointId }}
      />
      {deliveries.data.length === 0 ? (
        <EmptyState>No deliveries match this filter.</EmptyState>
      ) : (
        <DeliveriesTable deliveries={deliveries.data} endpointUrls={endpointUrls} />
      )}
      <Pagination
        pathname="/deliveries"
        filters={{ status, endpointId }}
        cursor={cursor}
        nextCursor={deliveries.nextCursor}
      />
    </>
  );
}

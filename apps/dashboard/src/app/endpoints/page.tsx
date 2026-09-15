import { MOCKPAY_EVENT_TYPES } from '@relayforge/shared/providers';
import type { Metadata } from 'next';
import { CreateEndpointForm, EndpointActiveToggle } from '@/components/forms';
import { Badge } from '@/components/status-badge';
import { Cell, Table } from '@/components/table';
import { Card, EmptyState, Mono, PageHeader, Section, TextLink } from '@/components/ui';
import { listEndpoints } from '@/lib/api/resources';
import { formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Endpoints' };

export default async function EndpointsPage() {
  const endpoints = await listEndpoints();

  return (
    <>
      <PageHeader
        title="Endpoints"
        description="Destinations for processed events. Each endpoint has its own signing secret; deliveries are signed with the Standard Webhooks scheme."
      />

      <Section title="Configured endpoints">
        {endpoints.data.length === 0 ? (
          <EmptyState>No endpoints yet. Create one below.</EmptyState>
        ) : (
          <Table caption="Webhook endpoints" head={['URL', 'Event types', 'State', 'Created', '']}>
            {endpoints.data.map((endpoint) => (
              <tr key={endpoint.id}>
                <Cell className="max-w-80 break-all">
                  <Mono>{endpoint.url}</Mono>
                  {endpoint.description !== null && (
                    <p className="text-muted mt-0.5 text-xs">{endpoint.description}</p>
                  )}
                  <p className="mt-0.5 text-xs">
                    <TextLink href={`/deliveries?endpointId=${endpoint.id}`}>Deliveries →</TextLink>
                  </p>
                </Cell>
                <Cell>
                  <ul className="space-y-0.5">
                    {endpoint.eventTypes.map((type) => (
                      <li key={type}>
                        <Mono>{type}</Mono>
                      </li>
                    ))}
                  </ul>
                </Cell>
                <Cell>
                  <Badge tone={endpoint.isActive ? 'ok' : 'idle'}>
                    {endpoint.isActive ? 'Active' : 'Disabled'}
                  </Badge>
                </Cell>
                <Cell className="whitespace-nowrap">{formatDateTime(endpoint.createdAt)}</Cell>
                <Cell>
                  <EndpointActiveToggle endpointId={endpoint.id} isActive={endpoint.isActive} />
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section
        title="New endpoint"
        description="URLs must use https unless ENDPOINT_ALLOW_HTTP is enabled. Deliveries to private, loopback and link-local addresses are blocked unless DELIVERY_ALLOW_PRIVATE_DESTINATIONS is enabled. The local compose stack enables both for the webhook sink."
      >
        <Card>
          <CreateEndpointForm eventTypes={MOCKPAY_EVENT_TYPES} />
        </Card>
      </Section>
    </>
  );
}

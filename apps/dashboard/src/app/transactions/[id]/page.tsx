import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JournalCard } from '@/components/journal-card';
import { StatusBadge } from '@/components/status-badge';
import { DetailList, EmptyState, Mono, PageHeader, Section, TextLink } from '@/components/ui';
import { orNotFound } from '@/lib/api/errors';
import { getTransaction } from '@/lib/api/resources';
import { formatDateTime, formatMinorUnits } from '@/lib/format';
import { isUuid } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Transaction' };

export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const transaction = await orNotFound(getTransaction(id));

  return (
    <>
      <PageHeader
        title={formatMinorUnits(transaction.amountMinor, transaction.currency)}
        description={
          <>
            Provider payment <Mono>{transaction.externalPaymentId}</Mono>
          </>
        }
        actions={<StatusBadge status={transaction.status} />}
      />

      <DetailList
        items={[
          ['Transaction id', <Mono key="id">{transaction.id}</Mono>],
          ['Status', <StatusBadge key="status" status={transaction.status} />],
          ['Amount', formatMinorUnits(transaction.amountMinor, transaction.currency)],
          ['Refunded', formatMinorUnits(transaction.refundedAmountMinor, transaction.currency)],
          [
            'Created by event',
            <TextLink key="event" href={`/events/${transaction.createdByEventId}`}>
              <Mono>{transaction.createdByEventId}</Mono>
            </TextLink>,
          ],
          ['Created', formatDateTime(transaction.createdAt)],
          ['Updated', formatDateTime(transaction.updatedAt)],
        ]}
      />

      <Section
        title="Ledger journals"
        description="Append-only double-entry records. Each journal's debits equal its credits."
      >
        {transaction.journals.length === 0 ? (
          <EmptyState>This transaction has no journals.</EmptyState>
        ) : (
          <div className="space-y-3">
            {transaction.journals.map((journal) => (
              <JournalCard key={journal.id} journal={journal} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

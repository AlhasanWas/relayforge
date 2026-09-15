import type { Metadata } from 'next';
import { JournalCard } from '@/components/journal-card';
import { FilterTabs, Pagination } from '@/components/list-controls';
import { EmptyState, PageHeader } from '@/components/ui';
import { listJournals } from '@/lib/api/resources';
import { JOURNAL_KINDS } from '@/lib/api/schemas';
import { enumParam, type SearchParams, uuidParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Ledger' };

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const kind = enumParam(params, 'kind', JOURNAL_KINDS);
  const cursor = uuidParam(params, 'cursor');
  const journals = await listJournals({ kind, cursor, limit: 10 });

  return (
    <>
      <PageHeader
        title="Ledger"
        description="Every journal in the workspace, newest first. Journals and postings cannot be edited or deleted; corrections are new journals."
      />
      <FilterTabs pathname="/ledger" param="kind" values={JOURNAL_KINDS} current={kind} />
      {journals.data.length === 0 ? (
        <EmptyState>No journals match this filter.</EmptyState>
      ) : (
        <div className="space-y-3">
          {journals.data.map((journal) => (
            <JournalCard key={journal.id} journal={journal} showTransaction />
          ))}
        </div>
      )}
      <Pagination
        pathname="/ledger"
        filters={{ kind }}
        cursor={cursor}
        nextCursor={journals.nextCursor}
      />
    </>
  );
}

import { Badge } from '@/components/status-badge';
import { Card, Mono, TextLink } from '@/components/ui';
import type { Journal } from '@/lib/api/schemas';
import { formatDateTime, formatMinorUnits, humanize, shortId } from '@/lib/format';

/** Debits and credits of one journal; the database refuses to commit an unbalanced one. */
export function journalTotals(journal: Journal): { debits: bigint; credits: bigint } {
  let debits = 0n;
  let credits = 0n;
  for (const posting of journal.postings) {
    if (posting.direction === 'DEBIT') debits += BigInt(posting.amountMinor);
    else credits += BigInt(posting.amountMinor);
  }
  return { debits, credits };
}

export function JournalCard({
  journal,
  showTransaction = false,
}: {
  journal: Journal;
  showTransaction?: boolean;
}) {
  const { debits, credits } = journalTotals(journal);
  const balanced = debits === credits;

  return (
    <Card>
      <div className="border-line flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">{humanize(journal.kind)}</p>
          <p className="text-muted text-xs">
            {formatDateTime(journal.createdAt)} · reference{' '}
            <Mono>{journal.externalReferenceId}</Mono>
            {showTransaction && (
              <>
                {' · '}
                <TextLink href={`/transactions/${journal.transactionId}`}>
                  transaction{' '}
                  <Mono title={journal.transactionId}>{shortId(journal.transactionId)}</Mono>
                </TextLink>
              </>
            )}
            {' · '}
            <TextLink href={`/events/${journal.sourceEventId}`}>source event</TextLink>
          </p>
        </div>
        <Badge tone={balanced ? 'ok' : 'bad'}>{balanced ? 'Balanced' : 'Unbalanced'}</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Postings of {humanize(journal.kind)}</caption>
          <thead className="text-muted text-xs">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Account
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Debit
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Credit
              </th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {journal.postings.map((posting) => (
              <tr key={posting.id}>
                <td className="px-4 py-2">
                  <Mono>{posting.accountCode}</Mono>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {posting.direction === 'DEBIT'
                    ? formatMinorUnits(posting.amountMinor, journal.currency)
                    : ''}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {posting.direction === 'CREDIT'
                    ? formatMinorUnits(posting.amountMinor, journal.currency)
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-line border-t text-xs">
            <tr>
              <th scope="row" className="text-muted px-4 py-2 text-left font-medium">
                Total
              </th>
              <td className="px-4 py-2 text-right font-medium tabular-nums">
                {formatMinorUnits(debits.toString(), journal.currency)}
              </td>
              <td className="px-4 py-2 text-right font-medium tabular-nums">
                {formatMinorUnits(credits.toString(), journal.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

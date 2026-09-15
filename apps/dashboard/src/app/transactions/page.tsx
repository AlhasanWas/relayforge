import type { Metadata } from 'next';
import { FilterTabs, Pagination } from '@/components/list-controls';
import { StatusBadge } from '@/components/status-badge';
import { Cell, Table } from '@/components/table';
import { EmptyState, Mono, PageHeader, Section, Stat, TextLink } from '@/components/ui';
import { getAccountBalances, listTransactions } from '@/lib/api/resources';
import { TRANSACTION_STATUSES } from '@/lib/api/schemas';
import { formatDateTime, formatMinorUnits, humanize } from '@/lib/format';
import { enumParam, type SearchParams, uuidParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Transactions' };

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const status = enumParam(params, 'status', TRANSACTION_STATUSES);
  const cursor = uuidParam(params, 'cursor');
  const [transactions, balances] = await Promise.all([
    listTransactions({ status, cursor }),
    getAccountBalances(),
  ]);

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Payments created from processed provider events. Every change is backed by a balanced ledger journal."
      />

      <Section
        title="Account balances"
        description="In each account's normal direction: debits minus credits for assets, credits minus debits for liabilities."
      >
        {balances.length === 0 ? (
          <EmptyState>No ledger accounts yet.</EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {balances.map((balance) => (
              <Stat
                key={`${balance.code}:${balance.currency}`}
                label={`${balance.code} · ${humanize(balance.type)}`}
                value={formatMinorUnits(balance.balanceMinor, balance.currency)}
                hint={`Debits ${formatMinorUnits(balance.debitsMinor, balance.currency)} · Credits ${formatMinorUnits(balance.creditsMinor, balance.currency)}`}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Transactions">
        <FilterTabs
          pathname="/transactions"
          param="status"
          values={TRANSACTION_STATUSES}
          current={status}
        />
        {transactions.data.length === 0 ? (
          <EmptyState>No transactions match this filter.</EmptyState>
        ) : (
          <Table
            caption="Transactions"
            head={['Created', 'Provider payment', 'Status', 'Amount', 'Refunded']}
          >
            {transactions.data.map((transaction) => (
              <tr key={transaction.id}>
                <Cell className="whitespace-nowrap">
                  <TextLink href={`/transactions/${transaction.id}`}>
                    {formatDateTime(transaction.createdAt)}
                  </TextLink>
                </Cell>
                <Cell>
                  <Mono>{transaction.externalPaymentId}</Mono>
                </Cell>
                <Cell>
                  <StatusBadge status={transaction.status} />
                </Cell>
                <Cell className="text-right tabular-nums">
                  {formatMinorUnits(transaction.amountMinor, transaction.currency)}
                </Cell>
                <Cell className="text-right tabular-nums">
                  {formatMinorUnits(transaction.refundedAmountMinor, transaction.currency)}
                </Cell>
              </tr>
            ))}
          </Table>
        )}
        <Pagination
          pathname="/transactions"
          filters={{ status }}
          cursor={cursor}
          nextCursor={transactions.nextCursor}
        />
      </Section>
    </>
  );
}

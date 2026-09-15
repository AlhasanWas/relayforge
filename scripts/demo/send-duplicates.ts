/**
 * pnpm demo:duplicate [count]
 *
 * Sends the same signed MockPay event `count` times concurrently (default 25), as a
 * provider retrying aggressively might, then shows through the API that RelayForge
 * stored one event, created one transaction and wrote one balanced journal.
 */
import {
  type EventSummary,
  getJson,
  loadDemoConfig,
  type Page,
  paymentSucceeded,
  postWebhook,
  print,
  runDemo,
  signAsMockPay,
  type TransactionDetail,
  waitFor,
} from './client';

runDemo(async () => {
  const config = loadDemoConfig();
  const count = Number(process.argv[2] ?? 25);
  if (!Number.isInteger(count) || count < 2 || count > 500) {
    throw new Error('count must be an integer between 2 and 500');
  }

  const event = paymentSucceeded(1500);
  // Signed once: every request carries identical bytes and headers.
  const webhook = signAsMockPay(config, event);
  print(`→ Sending ${event.id} ${count} times concurrently`);

  const responses = await Promise.all(
    Array.from({ length: count }, () => postWebhook(config, webhook)),
  );

  const byStatus = new Map<number, number>();
  for (const { status } of responses) {
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
  }
  const accepted = responses
    .filter((r) => r.status === 202)
    .map((r) => r.body as { duplicate: boolean });
  print(`← Status codes: ${[...byStatus].map(([status, n]) => `${status} × ${n}`).join(', ')}`);
  print(
    `  First deliveries (duplicate=false): ${accepted.filter((body) => !body.duplicate).length}`,
  );
  print(
    `  Recognised duplicates:              ${accepted.filter((body) => body.duplicate).length}`,
  );

  const events = await getJson<Page<EventSummary>>(
    config,
    `/v1/events?externalEventId=${event.id}`,
  );
  const processed = await waitFor(async () => {
    const [stored] = (
      await getJson<Page<EventSummary>>(config, `/v1/events?externalEventId=${event.id}`)
    ).data;
    return stored !== undefined && stored.status !== 'RECEIVED' ? stored : undefined;
  });
  const transactions = await getJson<Page<{ id: string }>>(
    config,
    `/v1/transactions?externalPaymentId=${event.data.payment_id}`,
  );
  const transactionId = transactions.data[0]?.id;
  const detail =
    transactionId === undefined
      ? undefined
      : await getJson<TransactionDetail>(config, `/v1/transactions/${transactionId}`);
  const postings = detail?.journals.flatMap((journal) => journal.postings) ?? [];

  print('\nStored in RelayForge:');
  print(
    `  Incoming events:     ${events.data.length}  (status ${processed?.status ?? 'RECEIVED'})`,
  );
  print(`  Transactions:        ${transactions.data.length}`);
  print(`  Ledger transactions: ${detail?.journals.length ?? 0}`);
  print(`  Ledger postings:     ${postings.length}`);

  const exactlyOnce =
    events.data.length === 1 &&
    transactions.data.length === 1 &&
    detail?.journals.length === 1 &&
    postings.length === 2;
  if (!exactlyOnce) {
    throw new Error('Expected exactly one event, one transaction, one journal and two postings');
  }
  print(`\n✓ ${count} identical requests produced exactly one event and one balanced journal.`);
});

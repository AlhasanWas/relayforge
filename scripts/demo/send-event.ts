/**
 * pnpm demo:event [amountMinor]
 *
 * Sends one signed MockPay payment.succeeded webhook and follows it through
 * RelayForge: ingestion, processing into the ledger, and delivery to the sink.
 */
import {
  type DeliverySummary,
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

const FINAL_DELIVERY_STATUSES = new Set(['SUCCEEDED', 'DEAD_LETTER']);

runDemo(async () => {
  const config = loadDemoConfig();
  const amountMinor = Number(process.argv[2] ?? 4200);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('amountMinor must be a positive integer, e.g. pnpm demo:event 1999');
  }

  const event = paymentSucceeded(amountMinor);
  print(`→ MockPay sends payment.succeeded ${event.id}`);
  print(`  payment ${event.data.payment_id}, ${amountMinor} minor units USD`);

  const startedAt = Date.now();
  const response = await postWebhook(config, signAsMockPay(config, event));
  print(`← ${response.status} ${JSON.stringify(response.body)}`);
  if (response.status !== 202) {
    throw new Error('RelayForge did not accept the webhook');
  }
  const { eventId } = response.body as { eventId: string };

  const processed = await waitFor(async () => {
    const found = await getJson<EventSummary>(config, `/v1/events/${eventId}`);
    return found.status === 'RECEIVED' ? undefined : found;
  });
  if (processed === undefined) {
    throw new Error('The event is still RECEIVED after 30 s. Is the worker running?');
  }
  print(`\n✓ Event ${processed.status} after ${Date.now() - startedAt} ms`);

  const transactions = await getJson<Page<{ id: string }>>(
    config,
    `/v1/transactions?externalPaymentId=${event.data.payment_id}`,
  );
  const transactionId = transactions.data[0]?.id;
  if (transactionId !== undefined) {
    const transaction = await getJson<TransactionDetail>(
      config,
      `/v1/transactions/${transactionId}`,
    );
    print(
      `  Transaction  ${transaction.status}  ${transaction.amountMinor} ${transaction.currency}`,
    );
    for (const journal of transaction.journals) {
      print(`  Journal      ${journal.kind}`);
      for (const posting of journal.postings) {
        print(
          `               ${posting.direction.padEnd(6)} ${posting.accountCode.padEnd(18)} ${posting.amountMinor}`,
        );
      }
    }
  }

  const delivery = await waitFor(async () => {
    const deliveries = await getJson<Page<DeliverySummary>>(
      config,
      `/v1/deliveries?eventId=${eventId}`,
    );
    const first = deliveries.data[0];
    return first !== undefined && FINAL_DELIVERY_STATUSES.has(first.status) ? first : undefined;
  }, 20_000);

  if (delivery === undefined) {
    print('\n… No delivery reached a final state within 20 s.');
    print(
      '  The sink may be failing on purpose (pnpm demo:sink SUCCESS), or retries are scheduled.',
    );
    return;
  }
  const reason = delivery.deadLetterReason === null ? '' : ` (${delivery.deadLetterReason})`;
  print(`\n✓ Delivery ${delivery.status}${reason} after ${delivery.attemptCount} attempt(s)`);
  print(`  Inspect it: GET ${config.apiUrl}/v1/deliveries/${delivery.id}`);
});

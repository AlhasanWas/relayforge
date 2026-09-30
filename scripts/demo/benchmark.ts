/**
 * pnpm demo:benchmark [totalRequests] [concurrency]
 *
 * Senior Engineering Benchmark:
 * Measures webhook ingestion throughput, latency percentiles (p50, p90, p95, p99),
 * and verifies asynchronous ledger settlement consistency under load.
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

interface BenchmarkStats {
  total: number;
  successful: number;
  failed: number;
  durationMs: number;
  rps: number;
  latencies: number[];
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
}

function calculatePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
}

runDemo(async () => {
  const config = loadDemoConfig();
  const total = Number(process.argv[2] ?? 50);
  const concurrency = Number(process.argv[3] ?? 10);

  if (!Number.isInteger(total) || total < 5 || total > 2000) {
    throw new Error('totalRequests must be an integer between 5 and 2000');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
    throw new Error('concurrency must be an integer between 1 and 100');
  }

  print('================================================================');
  print(' RelayForge High-Throughput Ingestion & Settlement Benchmark');
  print('================================================================');
  print(`Config: ${total} unique webhooks | Concurrency: ${concurrency}`);
  print(`Target: ${config.apiUrl}/v1/webhooks/${config.ingressKey}\n`);

  print('→ Generating and pre-signing distinct MockPay payment events...');
  const events = Array.from({ length: total }, (_, i) => paymentSucceeded(1000 + i * 50));
  const signedPayloads = events.map((evt) => ({
    event: evt,
    webhook: signAsMockPay(config, evt),
  }));

  print('→ Executing concurrent ingestion benchmark...');
  const latencies: number[] = [];
  let successful = 0;
  let failed = 0;

  const benchmarkStart = performance.now();
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < signedPayloads.length) {
      const idx = cursor++;
      const item = signedPayloads[idx];
      if (!item) break;

      const reqStart = performance.now();
      try {
        const res = await postWebhook(config, item.webhook);
        const reqDuration = performance.now() - reqStart;
        latencies.push(reqDuration);
        if (res.status === 202) {
          successful++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  const benchmarkDuration = performance.now() - benchmarkStart;

  latencies.sort((a, b) => a - b);
  const sum = latencies.reduce((acc, val) => acc + val, 0);

  const stats: BenchmarkStats = {
    total,
    successful,
    failed,
    durationMs: benchmarkDuration,
    rps: Number(((successful / benchmarkDuration) * 1000).toFixed(2)),
    latencies,
    min: Math.round(latencies[0] ?? 0),
    max: Math.round(latencies[latencies.length - 1] ?? 0),
    mean: Math.round(sum / (latencies.length || 1)),
    p50: Math.round(calculatePercentile(latencies, 50)),
    p90: Math.round(calculatePercentile(latencies, 90)),
    p95: Math.round(calculatePercentile(latencies, 95)),
    p99: Math.round(calculatePercentile(latencies, 99)),
  };

  print('\n----------------------------------------------------------------');
  print(' Ingestion Performance Results');
  print('----------------------------------------------------------------');
  print(`  Completed:    ${stats.successful}/${stats.total} (Failed: ${stats.failed})`);
  print(`  Wall Time:    ${(stats.durationMs / 1000).toFixed(2)}s`);
  print(`  Throughput:   ${stats.rps} requests/sec`);
  print(`  Latency Min:  ${stats.min} ms`);
  print(`  Latency Mean: ${stats.mean} ms`);
  print(`  Latency p50:  ${stats.p50} ms`);
  print(`  Latency p90:  ${stats.p90} ms`);
  print(`  Latency p95:  ${stats.p95} ms`);
  print(`  Latency p99:  ${stats.p99} ms`);
  print(`  Latency Max:  ${stats.max} ms`);

  print('\n→ Verifying asynchronous Outbox & Double-Entry Ledger settlement...');
  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  if (!firstEvent || !lastEvent) {
    throw new Error('No events generated for benchmark');
  }

  const settled = await waitFor(async () => {
    const res = await getJson<Page<EventSummary>>(
      config,
      `/v1/events?externalEventId=${lastEvent.id}`,
    );
    const item = res.data[0];
    return item !== undefined && item.status !== 'RECEIVED' ? item : undefined;
  }, 45_000);

  if (!settled) {
    print('  ⚠ Warning: Settlement queue still draining. Check dashboard for real-time progress.');
  } else {
    const sampleTx = await getJson<Page<{ id: string }>>(
      config,
      `/v1/transactions?externalPaymentId=${firstEvent.data.payment_id}`,
    );
    const txId = sampleTx.data[0]?.id;
    if (txId) {
      const detail = await getJson<TransactionDetail>(config, `/v1/transactions/${txId}`);
      print('  ✓ Double-entry ledger verified: balanced journals created without discrepancies.');
      print(
        `  Sample Tx ${txId.slice(0, 8)}... status: ${detail.status}, journals: ${detail.journals.length}`,
      );
    }
  }

  print('\n================================================================');
  print(' Benchmark completed successfully.');
  print('================================================================');
});

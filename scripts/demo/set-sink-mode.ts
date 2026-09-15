/**
 * pnpm demo:sink <SUCCESS | FAIL_500 | TIMEOUT | RANDOM_FAILURE> [failureRate]
 *
 * Switches how the local webhook sink answers, to watch retries, backoff and
 * dead-lettering happen. Example: pnpm demo:sink RANDOM_FAILURE 0.7
 */
import { loadDemoConfig, print, runDemo } from './client';

runDemo(async () => {
  const config = loadDemoConfig();
  const [mode, rate] = process.argv.slice(2);
  if (mode === undefined) {
    throw new Error(
      'Usage: pnpm demo:sink <SUCCESS|FAIL_500|TIMEOUT|RANDOM_FAILURE> [failureRate]',
    );
  }

  let response: Response;
  try {
    response = await fetch(`${config.sinkUrl}/mode`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, ...(rate === undefined ? {} : { failureRate: Number(rate) }) }),
    });
  } catch (error: unknown) {
    throw new Error(`Could not reach the webhook sink at ${config.sinkUrl}: ${String(error)}`, {
      cause: error,
    });
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`The sink rejected the change: ${JSON.stringify(body)}`);
  }
  print(`✓ Webhook sink mode is now ${JSON.stringify(body)}`);
  print(`  Recent webhooks: ${config.sinkUrl}/received`);
});

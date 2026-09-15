import { createSinkServer } from './server';
import { isSinkMode } from './sink-mode';
import { SinkState } from './sink-state';

function log(entry: Record<string, unknown>): void {
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), service: 'webhook-sink', ...entry })}\n`,
  );
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

function main(): void {
  const mode = process.env.SINK_MODE ?? 'SUCCESS';
  if (!isSinkMode(mode)) {
    throw new Error(`SINK_MODE must be SUCCESS, FAIL_500, TIMEOUT or RANDOM_FAILURE; got ${mode}`);
  }
  const port = readNumber('SINK_PORT', 4000);
  const state = new SinkState(mode, readNumber('SINK_RANDOM_FAILURE_RATE', 0.5));
  const server = createSinkServer({
    state,
    timeoutHoldMs: readNumber('SINK_TIMEOUT_HOLD_MS', 60_000),
    random: Math.random,
    log,
  });

  server.listen(port, () => {
    log({ level: 'info', msg: 'Webhook sink listening', port, mode });
  });
  const shutdown = () => {
    server.closeAllConnections();
    server.close();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`Webhook sink failed to start: ${String(error)}\n`);
  process.exitCode = 1;
}

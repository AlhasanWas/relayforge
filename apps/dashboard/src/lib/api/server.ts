import 'server-only';
import { z } from 'zod';
import { type ApiClient, createApiClient } from './client';

/**
 * The dashboard acts as the seeded demo workspace: its API key lives only in the
 * Next.js server process and is never sent to the browser. There is no login; see
 * docs/security.md.
 */
const environmentSchema = z.object({
  RELAYFORGE_API_URL: z.url().default('http://localhost:3000'),
  DASHBOARD_API_KEY: z.string().min(1, 'DASHBOARD_API_KEY must be set to a workspace API key'),
  DASHBOARD_API_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

let client: ApiClient | undefined;

/** Read lazily, so `next build` does not need runtime secrets. */
export function api(): ApiClient {
  if (client === undefined) {
    const environment = environmentSchema.parse(process.env);
    client = createApiClient({
      baseUrl: environment.RELAYFORGE_API_URL,
      apiKey: environment.DASHBOARD_API_KEY,
      timeoutMs: environment.DASHBOARD_API_TIMEOUT_MS,
    });
  }
  return client;
}

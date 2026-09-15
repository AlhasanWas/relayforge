import type { z } from 'zod';
import { errorEnvelopeSchema } from './schemas';

/** An error answered by the API, carrying its error envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | undefined,
    readonly details: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The API could not be reached, or answered with something that is not the documented contract. */
export class ApiUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiUnavailableError';
  }
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly fetch?: typeof fetch;
}

export type QueryValue = string | number | undefined;

export interface ApiClient {
  get<Schema extends z.ZodType>(
    path: string,
    schema: Schema,
    query?: Record<string, QueryValue>,
  ): Promise<z.infer<Schema>>;
  send<Schema extends z.ZodType>(
    method: 'POST' | 'PATCH',
    path: string,
    schema: Schema,
    body?: unknown,
  ): Promise<z.infer<Schema>>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  async function request<Schema extends z.ZodType>(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    schema: Schema,
    body: unknown,
  ): Promise<z.infer<Schema>> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${options.apiKey}`,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      text = await response.text();
    } catch (error: unknown) {
      throw new ApiUnavailableError(`The RelayForge API at ${baseUrl} could not be reached`, {
        cause: error,
      });
    }

    const payload = parseJson(text);
    if (!response.ok) {
      const envelope = errorEnvelopeSchema.safeParse(payload);
      if (!envelope.success) {
        throw new ApiUnavailableError(
          `The RelayForge API answered ${response.status} without an error envelope`,
        );
      }
      const { code, message, requestId, details } = envelope.data.error;
      throw new ApiError(response.status, code, message, requestId, details);
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiUnavailableError(`Unexpected response from ${method} ${new URL(url).pathname}`, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  return {
    get(path, schema, query = {}) {
      const url = new URL(`${baseUrl}${path}`);
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
      }
      return request('GET', url.toString(), schema, undefined);
    },
    send(method, path, schema, body) {
      return request(method, `${baseUrl}${path}`, schema, body);
    },
  };
}

function parseJson(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

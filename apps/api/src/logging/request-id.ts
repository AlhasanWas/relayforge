import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept caller-supplied request ids only when they cannot inject into log lines.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Reuses a safe incoming `x-request-id` or generates one, and echoes it on the response. */
export function resolveRequestId(request: IncomingMessage, response: ServerResponse): string {
  const supplied = request.headers[REQUEST_ID_HEADER];
  const requestId =
    typeof supplied === 'string' && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
  response.setHeader(REQUEST_ID_HEADER, requestId);
  return requestId;
}

/** The id assigned by `resolveRequestId`, or null if the request bypassed the logger middleware. */
export function requestIdOf(request: IncomingMessage): string | null {
  return typeof request.id === 'string' ? request.id : null;
}

import 'server-only';
import { notFound } from 'next/navigation';
import { ApiError, ApiUnavailableError } from './client';

/** Renders the not-found page when the API answers 404 for the requested resource. */
export async function orNotFound<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

/** A message safe to show next to a form; unexpected errors are rethrown to the error page. */
export function describeActionError(error: unknown): string {
  if (error instanceof ApiError) {
    const reference = error.requestId === undefined ? '' : ` (request ${error.requestId})`;
    return `${error.message}${reference}`;
  }
  if (error instanceof ApiUnavailableError) {
    return 'The RelayForge API could not be reached. Try again in a moment.';
  }
  throw error;
}

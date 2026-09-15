'use client';

import { Card } from '@/components/ui';

/**
 * Shown when a page cannot load, most often because the API is unreachable. In
 * production, server error messages are withheld from the browser; the digest
 * identifies the failure in the dashboard's server logs.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card className="px-5 py-6">
      <h1 className="text-base font-semibold">This page could not be loaded</h1>
      <p className="text-muted mt-1 text-sm">
        The dashboard could not get data from the RelayForge API. Check that the API is running and
        that DASHBOARD_API_KEY is a valid workspace key.
      </p>
      {error.digest !== undefined && (
        <p className="text-muted mt-3 font-mono text-xs">Reference: {error.digest}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="bg-accent text-accent-ink mt-4 rounded-md px-3 py-1.5 text-xs font-medium"
      >
        Try again
      </button>
    </Card>
  );
}

/** Liveness of the dashboard server itself; it does not call the API. */
export function GET(): Response {
  return Response.json({ status: 'ok' });
}

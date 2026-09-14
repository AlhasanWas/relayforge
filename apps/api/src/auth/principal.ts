import type { Request } from 'express';
import type { ApiKeyRole } from '../generated/prisma/client';

/** The authenticated caller. Workspace scope comes only from here, never from input. */
export interface Principal {
  readonly apiKeyId: string;
  readonly workspaceId: string;
  readonly role: ApiKeyRole;
}

export interface AuthenticatedRequest extends Request {
  principal: Principal;
}

export function attachPrincipal(request: Request, principal: Principal): void {
  Object.assign(request, { principal });
}

export function isAuthenticated(request: Request): request is AuthenticatedRequest {
  return 'principal' in request;
}

/** Principal of a request held as an untyped record (e.g. by third-party guards), if any. */
export function principalOf(request: Record<string, unknown>): Principal | undefined {
  const { principal } = request;
  if (typeof principal !== 'object' || principal === null) return undefined;
  return 'apiKeyId' in principal && typeof principal.apiKeyId === 'string'
    ? (principal as Principal)
    : undefined;
}

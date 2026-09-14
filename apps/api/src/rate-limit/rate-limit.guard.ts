import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { principalOf } from '../auth/principal';

/**
 * Runs after authentication. Authenticated callers are limited per API key, others
 * per client IP. The budget is shared across all routes: the default throttler key
 * would give every route its own separate budget.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override getTracker(request: Record<string, unknown>): Promise<string> {
    const principal = principalOf(request);
    if (principal !== undefined) {
      return Promise.resolve(`api-key:${principal.apiKeyId}`);
    }
    const ip = typeof request.ip === 'string' ? request.ip : 'unknown';
    return Promise.resolve(`ip:${ip}`);
  }

  protected override generateKey(
    _context: ExecutionContext,
    tracker: string,
    throttlerName: string,
  ): string {
    return `${throttlerName}:${tracker}`;
  }
}

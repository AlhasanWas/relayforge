import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { principalOf } from '../auth/principal';
import { rateLimitPolicyOf } from './rate-limit-policy';

/**
 * Runs after authentication.
 *
 * - Management API: one budget per API key shared across all routes (the default
 *   throttler key would give every route a separate budget).
 * - Webhook ingestion: one budget per ingress key and client IP, so a noisy sender
 *   cannot exhaust the budget of other connections.
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
    context: ExecutionContext,
    tracker: string,
    throttlerName: string,
  ): string {
    if (rateLimitPolicyOf(context) === 'ingestion') {
      const { publicIngressKey } = context.switchToHttp().getRequest<Request>().params;
      return `${throttlerName}:ingestion:${String(publicIngressKey).slice(0, 64)}:${tracker}`;
    }
    return `${throttlerName}:${tracker}`;
  }
}

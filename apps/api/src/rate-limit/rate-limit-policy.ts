import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export type RateLimitPolicyName = 'management' | 'ingestion';

const RATE_LIMIT_POLICY_KEY = 'relayforge:rateLimitPolicy';
const reflector = new Reflector();

/**
 * Selects the rate limit budget for a controller or route. Routes without a policy
 * use the management budget.
 */
export const RateLimitPolicy = (policy: RateLimitPolicyName): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_POLICY_KEY, policy);

export function rateLimitPolicyOf(context: ExecutionContext): RateLimitPolicyName {
  return (
    reflector.getAllAndOverride<RateLimitPolicyName | undefined>(RATE_LIMIT_POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? 'management'
  );
}

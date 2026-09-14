import { randomBytes } from 'node:crypto';

/**
 * Public ingress key: routes a webhook to a provider connection.
 *
 * It appears in URLs, provider dashboards and logs, so it is NOT a credential.
 * Authentication is always the HMAC signature. The 144 random bits only keep
 * drive-by traffic from reaching signature verification for real connections.
 */
const INGRESS_KEY_PATTERN = /^ing_[A-Za-z0-9_-]{24}$/;

export function generateIngressKey(): string {
  return `ing_${randomBytes(18).toString('base64url')}`;
}

export function isWellFormedIngressKey(value: string): boolean {
  return INGRESS_KEY_PATTERN.test(value);
}

export function ingressPath(ingressKey: string): string {
  return `/v1/webhooks/${ingressKey}`;
}

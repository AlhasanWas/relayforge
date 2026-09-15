import { HttpStatus } from '@nestjs/common';
import { AppError } from '../errors/app-error';

export interface EndpointUrlPolicy {
  /** Plain http is only acceptable for local development (for example the webhook sink). */
  readonly allowHttp: boolean;
}

/**
 * Checks what can be decided from the URL alone. Destination address checks
 * (private, loopback and link-local ranges) happen at delivery time against the
 * resolved IP, because DNS answers can change after an endpoint is registered.
 */
export function assertEndpointUrlAllowed(rawUrl: string, policy: EndpointUrlPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw invalidUrl('must be an absolute URL');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && policy.allowHttp)) {
    throw invalidUrl(policy.allowHttp ? 'must use http or https' : 'must use https');
  }
  if (url.username !== '' || url.password !== '') {
    // Credentials in URLs end up in logs and stored rows; signatures authenticate us instead.
    throw invalidUrl('must not contain credentials');
  }
  if (url.hash !== '') {
    throw invalidUrl('must not contain a fragment');
  }
  return url;
}

function invalidUrl(reason: string): AppError {
  return new AppError('INVALID_ENDPOINT_URL', `Endpoint URL ${reason}`, HttpStatus.BAD_REQUEST);
}

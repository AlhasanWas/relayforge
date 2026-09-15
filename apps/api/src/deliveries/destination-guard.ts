import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/**
 * Server-side request forgery protection for customer-configured webhook URLs.
 * Without it, an endpoint URL could make RelayForge send signed requests to
 * internal services, cloud metadata endpoints or the loopback interface.
 */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved and broadcast
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export class BlockedDestinationError extends Error {
  readonly code = 'BLOCKED_DESTINATION';

  constructor(address: string) {
    super(`Destination address ${address} is private or reserved`);
    this.name = 'BlockedDestinationError';
  }
}

export function isBlockedAddress(address: string): boolean {
  const mapped = IPV4_MAPPED.exec(address)?.[1];
  if (mapped !== undefined) {
    return BLOCKED.check(mapped, 'ipv4');
  }
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  if (family === 6) return BLOCKED.check(address, 'ipv6');
  // Not an IP address: nothing to check here (hostnames are checked after resolution).
  return false;
}

/**
 * A `lookup` for `http.request` that rejects the connection if any resolved address
 * is blocked. Checking the addresses actually connected to, rather than the URL,
 * defeats DNS rebinding: a hostname cannot pass validation and later resolve inward.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) {
      callback(error, '', 0);
      return;
    }
    const blocked = addresses.find((entry) => isBlockedAddress(entry.address));
    if (blocked !== undefined) {
      callback(new BlockedDestinationError(blocked.address), '', 0);
      return;
    }
    const first = addresses[0];
    if (options.all === true) {
      (callback as unknown as (err: null, addresses: LookupAddress[]) => void)(null, addresses);
    } else if (first !== undefined) {
      callback(null, first.address, first.family);
    } else {
      callback(new Error(`No addresses found for ${hostname}`), '', 0);
    }
  });
};

import { BlockedDestinationError, guardedLookup, isBlockedAddress } from './destination-guard';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
    '::7f00:1',
    '64:ff9b::7f00:1',
    '64:ff9b:1::a00:1',
    '2002:7f00:1::1',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    'fec0::1',
    '2001:db8::1',
    '192.0.2.1',
    '198.51.100.7',
    '203.0.113.9',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public address %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe('guardedLookup', () => {
  const resolve = (hostname: string) =>
    new Promise<{ error: NodeJS.ErrnoException | null; address: string }>((done) => {
      guardedLookup(hostname, { family: 4 }, (error, address) => {
        done({ error, address: typeof address === 'string' ? address : '' });
      });
    });

  it('rejects a hostname that resolves to a loopback address', async () => {
    const { error } = await resolve('localhost');

    expect(error).toBeInstanceOf(BlockedDestinationError);
  });
});

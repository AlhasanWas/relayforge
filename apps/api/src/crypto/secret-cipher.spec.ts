import { randomBytes } from 'node:crypto';
import { SecretCipher, SecretDecryptionError } from './secret-cipher';

const PURPOSE = 'provider_connection.signing_secret';
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

describe('SecretCipher', () => {
  const cipher = new SecretCipher(randomBytes(32));

  it('round-trips a secret', () => {
    expect(cipher.decrypt(cipher.encrypt(SECRET, PURPOSE), PURPOSE)).toBe(SECRET);
  });

  it('never includes the plaintext and uses a fresh IV for each encryption', () => {
    const first = cipher.encrypt(SECRET, PURPOSE);
    const second = cipher.encrypt(SECRET, PURPOSE);

    expect(first).not.toContain(SECRET);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('rejects a ciphertext used for a different purpose', () => {
    const encrypted = cipher.encrypt(SECRET, PURPOSE);

    expect(() => cipher.decrypt(encrypted, 'webhook_endpoint.signing_secret')).toThrow(
      SecretDecryptionError,
    );
  });

  it('rejects decryption with a different key', () => {
    const encrypted = cipher.encrypt(SECRET, PURPOSE);

    expect(() => new SecretCipher(randomBytes(32)).decrypt(encrypted, PURPOSE)).toThrow(
      SecretDecryptionError,
    );
  });

  it('detects tampering with the ciphertext', () => {
    const [version, iv, tag, ciphertext = ''] = cipher.encrypt(SECRET, PURPOSE).split('.');
    const bytes = Buffer.from(ciphertext, 'base64url');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    const tampered = [version, iv, tag, bytes.toString('base64url')].join('.');

    expect(() => cipher.decrypt(tampered, PURPOSE)).toThrow(SecretDecryptionError);
  });

  it.each([
    ['an unknown format version', (value: string) => value.replace(/^v1\./, 'v2.')],
    ['a missing part', (value: string) => value.split('.').slice(0, 3).join('.')],
    ['a truncated IV', (value: string) => value.replace(/^v1\.[\w-]{4}/, 'v1.')],
  ])('rejects %s', (_label, corrupt) => {
    expect(() => cipher.decrypt(corrupt(cipher.encrypt(SECRET, PURPOSE)), PURPOSE)).toThrow(
      SecretDecryptionError,
    );
  });

  it('requires a 256-bit key', () => {
    expect(() => new SecretCipher(randomBytes(16))).toThrow(/32-byte key/);
  });
});

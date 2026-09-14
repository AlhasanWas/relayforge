import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const FORMAT_VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * Where an encrypted secret is stored. Used as GCM additional authenticated data,
 * so a ciphertext copied into a different column fails to decrypt.
 */
export type SecretPurpose =
  'provider_connection.signing_secret' | 'webhook_endpoint.signing_secret';

export class SecretDecryptionError extends Error {
  constructor() {
    // Deliberately uninformative: the reason (tampering, wrong key, wrong purpose)
    // must not become an oracle.
    super('Secret could not be decrypted');
    this.name = 'SecretDecryptionError';
  }
}

/**
 * Authenticated encryption for secrets RelayForge must be able to read back, such
 * as webhook signing secrets. (API keys are never encrypted: only their hash is stored.)
 *
 * Output format: `v1.<iv>.<authTag>.<ciphertext>`, each part base64url encoded.
 * The version prefix leaves room for key rotation.
 */
export class SecretCipher {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== KEY_BYTES) {
      throw new Error(`SecretCipher requires a ${KEY_BYTES}-byte key`);
    }
    this.key = Buffer.from(key);
  }

  encrypt(plaintext: string, purpose: SecretPurpose): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(Buffer.from(purpose, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [FORMAT_VERSION, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  decrypt(payload: string, purpose: SecretPurpose): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
      throw new SecretDecryptionError();
    }
    const [, ivPart = '', tagPart = '', ciphertextPart = ''] = parts;
    const iv = Buffer.from(ivPart, 'base64url');
    const authTag = Buffer.from(tagPart, 'base64url');
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
      throw new SecretDecryptionError();
    }

    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_BYTES });
      decipher.setAAD(Buffer.from(purpose, 'utf8'));
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextPart, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // `final()` throws on any authentication failure; the cause carries no extra
      // information worth exposing and is intentionally replaced.
      throw new SecretDecryptionError();
    }
  }
}

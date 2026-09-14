import { Injectable } from '@nestjs/common';
import { Clock } from '../clock/clock';
import { PrismaService } from '../database/prisma.service';
import { hashApiKey, isWellFormedApiKey } from './api-key';
import type { Principal } from './principal';

/** `last_used_at` is refreshed at most this often per key to avoid a write per request. */
const LAST_USED_RESOLUTION_MS = 60_000;

@Injectable()
export class ApiKeyAuthenticator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** Returns the principal for an active key, or null for unknown, malformed or revoked keys. */
  async authenticate(token: string): Promise<Principal | null> {
    if (!isWellFormedApiKey(token)) {
      return null;
    }

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(token) },
      select: { id: true, workspaceId: true, role: true, revokedAt: true },
    });
    // Unknown (null row) or revoked.
    if (apiKey?.revokedAt !== null) {
      return null;
    }

    await this.recordUsage(apiKey.id);
    return { apiKeyId: apiKey.id, workspaceId: apiKey.workspaceId, role: apiKey.role };
  }

  private async recordUsage(apiKeyId: string): Promise<void> {
    const now = this.clock.now();
    await this.prisma.apiKey.updateMany({
      where: {
        id: apiKeyId,
        revokedAt: null,
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_RESOLUTION_MS) } },
        ],
      },
      data: { lastUsedAt: now },
    });
  }
}

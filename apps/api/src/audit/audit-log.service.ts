import { Injectable } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { AuditActorType, type Prisma } from '../generated/prisma/client';

export type AuditAction =
  | 'api_key.created'
  | 'api_key.revoked'
  | 'endpoint.created'
  | 'endpoint.updated'
  | 'endpoint.deleted';

export interface AuditEntry {
  readonly workspaceId: string;
  /** The API key that performed the action, or `system` for automated actions. */
  readonly actor: Principal | 'system';
  readonly action: AuditAction;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Descriptive context. Must never contain secrets, keys or signatures. */
  readonly metadata: Prisma.InputJsonObject;
  readonly requestId: string | null;
}

@Injectable()
export class AuditLogService {
  /**
   * Records an audit entry inside the caller's transaction, so the entry exists if
   * and only if the audited change commits.
   */
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    const isSystem = entry.actor === 'system';
    await tx.auditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        actorType: isSystem ? AuditActorType.SYSTEM : AuditActorType.API_KEY,
        actorId: isSystem ? null : entry.actor.apiKeyId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata,
        requestId: entry.requestId,
      },
    });
  }
}

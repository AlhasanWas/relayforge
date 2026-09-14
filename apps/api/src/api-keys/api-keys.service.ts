import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { generateApiKey } from '../auth/api-key';
import type { Principal } from '../auth/principal';
import { Clock } from '../clock/clock';
import { PrismaService } from '../database/prisma.service';
import { AppError, NotFoundError } from '../errors/app-error';
import { ApiKeyRole } from '../generated/prisma/client';
import { type Page, type PageQueryDto, pageArgs, toPage } from '../http/pagination';
import {
  type ApiKeyResponse,
  type CreateApiKeyDto,
  type CreatedApiKeyResponse,
  toApiKeyResponse,
} from './api-key.dto';

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly clock: Clock,
  ) {}

  async create(
    principal: Principal,
    input: CreateApiKeyDto,
    requestId: string | null,
  ): Promise<CreatedApiKeyResponse> {
    const generated = generateApiKey();

    const apiKey = await this.prisma.$transaction(async (tx) => {
      const created = await tx.apiKey.create({
        data: {
          workspaceId: principal.workspaceId,
          name: input.name,
          role: input.role,
          prefix: generated.prefix,
          keyHash: generated.hash,
        },
      });
      await this.audit.record(tx, {
        workspaceId: principal.workspaceId,
        actor: principal,
        action: 'api_key.created',
        resourceType: 'api_key',
        resourceId: created.id,
        metadata: { name: created.name, role: created.role, prefix: created.prefix },
        requestId,
      });
      return created;
    });

    return Object.assign(toApiKeyResponse(apiKey), { key: generated.key });
  }

  async list(workspaceId: string, query: PageQueryDto): Promise<Page<ApiKeyResponse>> {
    const args = pageArgs(query);
    const rows = await this.prisma.apiKey.findMany({
      ...args,
      where: { ...args.where, workspaceId },
    });
    return toPage(rows, query, toApiKeyResponse);
  }

  /**
   * Revokes a key. Idempotent: revoking an already revoked key succeeds without a
   * second audit entry. A workspace can never lose its last active ADMIN key.
   */
  async revoke(principal: Principal, apiKeyId: string, requestId: string | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Role and workspace are immutable (enforced by trigger), so this unlocked read
      // is safe for choosing the locking strategy below.
      const target = await tx.apiKey.findFirst({
        where: { id: apiKeyId, workspaceId: principal.workspaceId },
        select: { id: true, role: true, prefix: true },
      });
      if (target === null) {
        throw new NotFoundError('API key', apiKeyId);
      }

      if (target.role === ApiKeyRole.ADMIN) {
        // Lock every active admin key in id order. Concurrent revocations in the same
        // workspace serialise here (consistent lock order, so no deadlock) and each sees
        // the committed result of the previous one.
        const activeAdmins = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM api_keys
           WHERE workspace_id = ${principal.workspaceId}::uuid
             AND role = 'ADMIN'
             AND revoked_at IS NULL
           ORDER BY id
             FOR UPDATE`;
        if (!activeAdmins.some((key) => key.id === target.id)) {
          return;
        }
        if (activeAdmins.length === 1) {
          throw new AppError(
            'LAST_ADMIN_KEY',
            'The last active ADMIN key of a workspace cannot be revoked',
            HttpStatus.CONFLICT,
          );
        }
      }

      const revoked = await tx.apiKey.updateMany({
        where: { id: target.id, revokedAt: null },
        data: { revokedAt: this.clock.now() },
      });
      if (revoked.count === 0) {
        return;
      }

      await this.audit.record(tx, {
        workspaceId: principal.workspaceId,
        actor: principal,
        action: 'api_key.revoked',
        resourceType: 'api_key',
        resourceId: target.id,
        metadata: { prefix: target.prefix, role: target.role },
        requestId,
      });
    });
  }
}

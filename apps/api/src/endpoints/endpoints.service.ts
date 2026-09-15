import { Inject, Injectable } from '@nestjs/common';
import { generateWebhookSecret } from '@relayforge/shared/webhooks';
import { AuditLogService } from '../audit/audit-log.service';
import type { Principal } from '../auth/principal';
import { Clock } from '../clock/clock';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { SecretCipher } from '../crypto/secret-cipher';
import { PrismaService } from '../database/prisma.service';
import { NotFoundError } from '../errors/app-error';
import type { Prisma } from '../generated/prisma/client';
import { type Page, type PageQueryDto, pageArgs, toPage } from '../http/pagination';
import {
  type CreateEndpointDto,
  type CreatedEndpointResponse,
  type EndpointResponse,
  toEndpointResponse,
  type UpdateEndpointDto,
} from './endpoint.dto';
import { assertEndpointUrlAllowed } from './endpoint-url-policy';

const WITHOUT_SECRET = { signingSecretEncrypted: true } as const;
const UPDATABLE_FIELDS = ['url', 'description', 'eventTypes', 'isActive'] as const;

@Injectable()
export class EndpointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: SecretCipher,
    private readonly audit: AuditLogService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(
    principal: Principal,
    input: CreateEndpointDto,
    requestId: string | null,
  ): Promise<CreatedEndpointResponse> {
    assertEndpointUrlAllowed(input.url, this.config.endpoints);
    const signingSecret = generateWebhookSecret();

    const endpoint = await this.prisma.$transaction(async (tx) => {
      const created = await tx.webhookEndpoint.create({
        data: {
          workspaceId: principal.workspaceId,
          url: input.url,
          description: input.description ?? null,
          eventTypes: input.eventTypes,
          signingSecretEncrypted: this.cipher.encrypt(
            signingSecret,
            'webhook_endpoint.signing_secret',
          ),
        },
        omit: WITHOUT_SECRET,
      });
      await this.audit.record(tx, {
        workspaceId: principal.workspaceId,
        actor: principal,
        action: 'endpoint.created',
        resourceType: 'webhook_endpoint',
        resourceId: created.id,
        metadata: { url: created.url, eventTypes: created.eventTypes },
        requestId,
      });
      return created;
    });

    return Object.assign(toEndpointResponse(endpoint), { signingSecret });
  }

  async list(workspaceId: string, query: PageQueryDto): Promise<Page<EndpointResponse>> {
    const args = pageArgs(query);
    const rows = await this.prisma.webhookEndpoint.findMany({
      ...args,
      where: { ...args.where, workspaceId, deletedAt: null },
      omit: WITHOUT_SECRET,
    });
    return toPage(rows, query, toEndpointResponse);
  }

  async get(workspaceId: string, endpointId: string): Promise<EndpointResponse> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id: endpointId, workspaceId, deletedAt: null },
      omit: WITHOUT_SECRET,
    });
    if (endpoint === null) {
      throw new NotFoundError('Endpoint', endpointId);
    }
    return toEndpointResponse(endpoint);
  }

  async update(
    principal: Principal,
    endpointId: string,
    input: UpdateEndpointDto,
    requestId: string | null,
  ): Promise<EndpointResponse> {
    if (input.url !== undefined) {
      assertEndpointUrlAllowed(input.url, this.config.endpoints);
    }
    const changes: Prisma.WebhookEndpointUpdateInput = {
      url: input.url,
      description: input.description,
      eventTypes: input.eventTypes,
      isActive: input.isActive,
    };
    const changedFields = UPDATABLE_FIELDS.filter((field) => input[field] !== undefined);

    const endpoint = await this.prisma.$transaction(async (tx) => {
      await this.requireActiveRecord(tx, principal.workspaceId, endpointId);
      const updated = await tx.webhookEndpoint.update({
        where: { id: endpointId },
        data: changes,
        omit: WITHOUT_SECRET,
      });
      if (changedFields.length > 0) {
        await this.audit.record(tx, {
          workspaceId: principal.workspaceId,
          actor: principal,
          action: 'endpoint.updated',
          resourceType: 'webhook_endpoint',
          resourceId: endpointId,
          metadata: { changedFields },
          requestId,
        });
      }
      return updated;
    });
    return toEndpointResponse(endpoint);
  }

  /** Soft delete: delivery history keeps referencing the endpoint. */
  async remove(principal: Principal, endpointId: string, requestId: string | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.requireActiveRecord(tx, principal.workspaceId, endpointId);
      await tx.webhookEndpoint.update({
        where: { id: endpointId },
        data: { deletedAt: this.clock.now(), isActive: false },
      });
      await this.audit.record(tx, {
        workspaceId: principal.workspaceId,
        actor: principal,
        action: 'endpoint.deleted',
        resourceType: 'webhook_endpoint',
        resourceId: endpointId,
        metadata: {},
        requestId,
      });
    });
  }

  private async requireActiveRecord(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    endpointId: string,
  ): Promise<void> {
    const found = await tx.webhookEndpoint.findFirst({
      where: { id: endpointId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (found === null) {
      throw new NotFoundError('Endpoint', endpointId);
    }
  }
}

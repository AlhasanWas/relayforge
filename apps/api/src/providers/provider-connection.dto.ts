import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ProviderAdapterType,
  type ProviderConnection,
  type ProviderDefinition,
} from '../generated/prisma/client';
import { ingressPath } from '../ingestion/ingress-key';

export class ProviderSummary {
  @ApiProperty({ example: 'mockpay' })
  slug!: string;

  @ApiProperty({ example: 'MockPay' })
  displayName!: string;

  @ApiProperty({ enum: ProviderAdapterType })
  adapterType!: ProviderAdapterType;
}

export class ProviderConnectionResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: ProviderSummary })
  provider!: ProviderSummary;

  @ApiProperty({ description: 'Routing identifier, not a credential' })
  publicIngressKey!: string;

  @ApiProperty({ example: '/v1/webhooks/ing_…', description: 'Path providers send webhooks to' })
  ingressPath!: string;

  @ApiPropertyOptional({ nullable: true, type: Number })
  timestampToleranceSec!: number | null;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ProviderConnectionPageResponse {
  @ApiProperty({ type: [ProviderConnectionResponse] })
  data!: ProviderConnectionResponse[];

  @ApiPropertyOptional({ nullable: true, type: String })
  nextCursor!: string | null;
}

/** A connection as loaded for display: the encrypted secret is never selected. */
export type ProviderConnectionView = Omit<ProviderConnection, 'signingSecretEncrypted'> & {
  providerDefinition: ProviderDefinition;
};

export function toProviderConnectionResponse(
  connection: ProviderConnectionView,
): ProviderConnectionResponse {
  return {
    id: connection.id,
    name: connection.name,
    provider: {
      slug: connection.providerDefinition.slug,
      displayName: connection.providerDefinition.displayName,
      adapterType: connection.providerDefinition.adapterType,
    },
    publicIngressKey: connection.publicIngressKey,
    ingressPath: ingressPath(connection.publicIngressKey),
    timestampToleranceSec: connection.timestampToleranceSec,
    enabled: connection.enabled,
    createdAt: connection.createdAt.toISOString(),
  };
}

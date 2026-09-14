import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { type ApiKey, ApiKeyRole } from '../generated/prisma/client';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'CI deploy', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ enum: ApiKeyRole, example: ApiKeyRole.MEMBER })
  @IsEnum(ApiKeyRole)
  role!: ApiKeyRole;
}

export class ApiKeyResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ApiKeyRole })
  role!: ApiKeyRole;

  @ApiProperty({ example: 'rf_3f9c2a7b1d4e8f60', description: 'Non-secret identifier' })
  prefix!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  lastUsedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  revokedAt!: string | null;
}

export class CreatedApiKeyResponse extends ApiKeyResponse {
  @ApiProperty({ description: 'The full API key. Shown only in this response; store it securely.' })
  key!: string;
}

export class ApiKeyPageResponse {
  @ApiProperty({ type: [ApiKeyResponse] })
  data!: ApiKeyResponse[];

  @ApiPropertyOptional({ nullable: true, type: String })
  nextCursor!: string | null;
}

export function toApiKeyResponse(apiKey: ApiKey): ApiKeyResponse {
  return {
    id: apiKey.id,
    name: apiKey.name,
    role: apiKey.role,
    prefix: apiKey.prefix,
    createdAt: apiKey.createdAt.toISOString(),
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    revokedAt: apiKey.revokedAt?.toISOString() ?? null,
  };
}

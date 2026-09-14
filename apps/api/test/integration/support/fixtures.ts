/** Application-level fixtures, created through Prisma with the same rules the API uses. */
import { generateApiKey } from '../../../src/auth/api-key';
import type { PrismaService } from '../../../src/database/prisma.service';
import { ApiKeyRole } from '../../../src/generated/prisma/client';

export interface TestApiKey {
  id: string;
  workspaceId: string;
  role: ApiKeyRole;
  /** The plaintext key, usable in an Authorization header. */
  key: string;
}

export async function createWorkspace(
  prisma: PrismaService,
  name = 'Test workspace',
): Promise<string> {
  const workspace = await prisma.workspace.create({ data: { name } });
  return workspace.id;
}

export async function createApiKey(
  prisma: PrismaService,
  workspaceId: string,
  role: ApiKeyRole = ApiKeyRole.ADMIN,
): Promise<TestApiKey> {
  const generated = generateApiKey();
  const apiKey = await prisma.apiKey.create({
    data: {
      workspaceId,
      name: `${role.toLowerCase()} key`,
      role,
      prefix: generated.prefix,
      keyHash: generated.hash,
    },
  });
  return { id: apiKey.id, workspaceId, role, key: generated.key };
}

/** A workspace with one ADMIN key: the minimum needed to call the management API. */
export async function createWorkspaceWithAdminKey(prisma: PrismaService): Promise<TestApiKey> {
  return createApiKey(prisma, await createWorkspace(prisma), ApiKeyRole.ADMIN);
}

export function bearer(apiKey: TestApiKey): { Authorization: string } {
  return { Authorization: `Bearer ${apiKey.key}` };
}

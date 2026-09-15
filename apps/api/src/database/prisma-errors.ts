import { Prisma } from '../generated/prisma/client';

/** True for a unique constraint violation, optionally on a specific constraint or index. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  return constraint === undefined || JSON.stringify(error.meta ?? {}).includes(constraint);
}

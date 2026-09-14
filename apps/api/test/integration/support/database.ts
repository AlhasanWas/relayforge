import { Pool, type PoolClient } from 'pg';
import { assertDisposableTestDatabase, TEST_DATABASE_URL } from './test-environment';

/** PostgreSQL SQLSTATE codes asserted by the tests. */
export const SqlState = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  RESTRICT_VIOLATION: '23001',
} as const;

export type SqlStateCode = (typeof SqlState)[keyof typeof SqlState];

export function createTestPool(): Pool {
  assertDisposableTestDatabase(TEST_DATABASE_URL);
  return new Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
}

export async function truncateAllTables(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
  // TRUNCATE does not fire row-level triggers, so append-only tables can be reset.
  await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

/** Runs `work` in one database transaction and commits it; rolls back on any error. */
export async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function expectSqlState(
  operation: Promise<unknown>,
  code: SqlStateCode,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code });
}

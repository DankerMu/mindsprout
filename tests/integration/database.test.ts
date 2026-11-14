import { describe, expect, it } from 'vitest';
import postgres from 'postgres';

// Real-database integration seam. DATABASE_URL defaults to the docker-compose instance;
// an unreachable database FAILS this suite — it never self-skips into green.
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://app:app@localhost:5432/app_test';

describe('postgres integration seam', () => {
  it('answers select 1 on the configured database', async () => {
    const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
    try {
      const rows = await sql<{ one: number }[]>`select 1 as one`;
      expect(rows[0]?.one).toBe(1);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });
});

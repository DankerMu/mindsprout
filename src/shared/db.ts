import postgres from 'postgres';

export type DbPing = 'ok' | 'fail' | 'not-configured';

// Health-check level dependency probe. Application data access goes through each bounded
// context's infrastructure/ layer and Supabase RLS, never through this helper.
export async function pingDatabase(
  databaseUrl: string | undefined,
  timeoutMs = 2000,
): Promise<DbPing> {
  if (!databaseUrl) return 'not-configured';
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: Math.ceil(timeoutMs / 1000) });
  try {
    await sql`select 1`;
    return 'ok';
  } catch {
    return 'fail';
  } finally {
    await sql.end({ timeout: 1 });
  }
}

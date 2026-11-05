import { NextResponse } from 'next/server';
import { pingDatabase } from '@/shared/db';

export const dynamic = 'force-dynamic';

// Liveness + dependency probe (AGENTS.md ## Verification Matrix, smoke/health.hurl).
export async function GET() {
  const db = await pingDatabase(process.env.DATABASE_URL);
  const status = db === 'fail' ? 'degraded' : 'ok';
  return NextResponse.json({ status, checks: { db } }, { status: status === 'ok' ? 200 : 503 });
}

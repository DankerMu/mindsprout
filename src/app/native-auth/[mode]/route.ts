import { safeNextPath } from '../../../shared/safe-next-path';

export async function POST(request: Request, { params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  if (mode !== 'login' && mode !== 'register') return new Response(null, { status: 404 });

  const next = new URL(request.url).searchParams.get('next');
  const suffix = next === null ? '' : `&next=${encodeURIComponent(safeNextPath(next))}`;
  return new Response(null, {
    status: 303,
    headers: { Location: `/${mode}?native=1${suffix}` },
  });
}

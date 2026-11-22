import { nativeAuthFallback } from '@/app/server/account-services';

export function POST(request: Request): Response {
  return nativeAuthFallback(request, 'login');
}

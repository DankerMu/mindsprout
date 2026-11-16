import { request, type FullConfig } from '@playwright/test';
import { E2E_ADMIN_USERNAME, E2E_ADMIN_PASSWORD } from './support/session';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (baseURL === undefined) throw new Error('Missing Playwright baseURL');

  const context = await request.newContext({ baseURL });
  try {
    const response = await context.post('/api/auth/register', {
      data: { username: E2E_ADMIN_USERNAME, password: E2E_ADMIN_PASSWORD },
    });
    if (response.status() !== 201) {
      throw new Error(`/api/auth/register: expected 201, received ${String(response.status())}`);
    }
    const session = (await response.json()) as { isAdmin?: unknown } | null;
    if (session?.isAdmin !== true) {
      throw new Error('/api/auth/register: first account is not an administrator');
    }
  } finally {
    await context.dispose();
  }
}

import { randomUUID } from 'node:crypto';
import { test as base, type BrowserContext, type Page } from '@playwright/test';

export const E2E_ADMIN_USERNAME = 'e2e-admin';
export const E2E_ADMIN_PASSWORD = 'e2e-admin-password';
const REGULAR_PASSWORD = 'e2e-user-password';

export interface Session {
  readonly username: string;
  readonly isAdmin: boolean;
}

async function post(
  context: BrowserContext,
  path: string,
  body: Record<string, string>,
  expected: number,
): Promise<Session> {
  const response = await context.request.post(path, { data: body });
  if (response.status() !== expected) {
    throw new Error(`${path}: expected ${String(expected)}, received ${String(response.status())}`);
  }
  return (await response.json()) as Session;
}

export const test = base.extend<{ session: Session; adminPage: Page }>({
  session: [
    async ({ context }, provide) => {
      const session = await post(
        context,
        '/api/auth/register',
        { username: `u-${randomUUID()}`, password: REGULAR_PASSWORD },
        201,
      );
      await provide(session);
    },
    { auto: true },
  ],
  adminPage: async ({ browser, baseURL, timezoneId }, provide) => {
    if (baseURL === undefined) throw new Error('Missing Playwright baseURL');
    const context = await browser.newContext({ baseURL, ...(timezoneId && { timezoneId }) });
    try {
      await post(
        context,
        '/api/auth/login',
        { username: E2E_ADMIN_USERNAME, password: E2E_ADMIN_PASSWORD },
        200,
      );
      await provide(await context.newPage());
    } finally {
      await context.close();
    }
  },
});

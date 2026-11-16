import { expect } from '@playwright/test';
import { test, E2E_ADMIN_USERNAME } from './support/session';

test('session fixture signs in the default page as a fresh regular user', async ({
  page,
  session,
}) => {
  expect(session.username).toMatch(/^u-/);
  expect(session.isAdmin).toBe(false);

  const response = await page.request.get('/api/auth/session');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ username: session.username, isAdmin: false });
});

test('session fixture keeps regular and admin sessions isolated', async ({
  page,
  session,
  adminPage,
}) => {
  const regularResponse = await page.request.get('/api/auth/session');
  expect(regularResponse.status()).toBe(200);
  expect(await regularResponse.json()).toEqual({ username: session.username, isAdmin: false });

  const adminResponse = await adminPage.request.get('/api/auth/session');
  expect(adminResponse.status()).toBe(200);
  expect(await adminResponse.json()).toEqual({ username: E2E_ADMIN_USERNAME, isAdmin: true });
});

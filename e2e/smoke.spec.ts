import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';

// Key UI paths (Q7.3) — keep in sync with AGENTS.md ## Verification Matrix and
// constraints.yaml verification.key_ui_paths. `/maps/[id]` joins this list when the editor lands.
const routes: { path: string; name: string }[] = [{ path: '/', name: 'home' }];

fs.mkdirSync('.run/ui-evidence', { recursive: true });

for (const route of routes) {
  test(`route ${route.path} renders without console errors`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    const response = await page.goto(route.path);
    expect(response?.ok(), `HTTP status for ${route.path}`).toBe(true);
    await page.waitForLoadState('load');
    await page.waitForSelector('[data-testid="app-ready"]');

    await page.screenshot({ path: `.run/ui-evidence/${route.name}.png`, fullPage: true });

    expect(consoleErrors, `console errors on ${route.path}`).toEqual([]);
  });
}

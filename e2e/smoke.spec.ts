import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { envelopeOf, seedRecords } from './support/seed';

// Key UI paths (Q7.3) — keep in sync with AGENTS.md ## Verification Matrix and
// constraints.yaml verification.key_ui_paths.
const EDITOR_MAP = {
  title: 'Smoke editor map',
  roots: [{ id: 'smoke-root', text: 'Smoke root content', children: [] }],
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
};
const routes: {
  path: string;
  name: string;
  ready: string;
  map?: typeof EDITOR_MAP;
}[] = [
  { path: '/', name: 'home', ready: 'app-ready' },
  { path: '/maps/[id]', name: 'editor', ready: 'map-editor-ready', map: EDITOR_MAP },
];

fs.mkdirSync('.run/ui-evidence', { recursive: true });

for (const route of routes) {
  test(`route ${route.path} renders without console errors`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    const map = route.map ? { ...route.map, id: randomUUID() } : undefined;
    if (map) await seedRecords(page, [envelopeOf(map)]);
    const path = map ? `/maps/${map.id}` : route.path;
    const response = await page.goto(path);
    expect(response?.ok(), `HTTP status for ${path}`).toBe(true);
    await page.waitForLoadState('load');
    await page.waitForSelector(`[data-testid="${route.ready}"]`);
    if (map) {
      await expect(page.getByTestId('editor-title')).toBeVisible();
      await expect(page.getByTestId('editor-title')).toHaveText(map.title);
      const root = page.locator('.react-flow__node[data-id="smoke-root"]');
      await expect(root).toBeVisible();
      await expect(root).toHaveText('Smoke root content');
    }

    await page.screenshot({ path: `.run/ui-evidence/${route.name}.png`, fullPage: true });

    expect(consoleErrors, `console errors on ${route.path}`).toEqual([]);
  });
}

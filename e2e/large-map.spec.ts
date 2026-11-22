import { expect } from '@playwright/test';
import { test } from './support/session';
import * as fs from 'node:fs';
import type { MindMap } from '../src/contexts/map/domain/types';
import { createLargeMap } from './fixtures/large-map';
import { envelopeOf, seedRecords } from './support/seed';

const EVIDENCE = '.run/ui-evidence';
fs.mkdirSync(EVIDENCE, { recursive: true });

function assertWorkload(map: MindMap): Set<object> {
  expect(map.roots).toHaveLength(1);
  const entries = map.roots.map((node) => ({ node, depth: 0 }));
  const ids = new Set<string>();
  const objects = new Set<object>([map, map.roots]);
  let maxDepth = 0;

  for (const { node, depth } of entries) {
    expect(ids.has(node.id), `duplicate node ${node.id}`).toBe(false);
    ids.add(node.id);
    objects.add(node);
    objects.add(node.children);
    expect(node.collapsed ?? false).toBe(false);
    expect(node).not.toHaveProperty('position');
    if (node.children.length > 0) {
      expect(node.children.length).toBeGreaterThanOrEqual(3);
      expect(node.children.length).toBeLessThanOrEqual(7);
    }
    maxDepth = Math.max(maxDepth, depth);
    for (const child of node.children) entries.push({ node: child, depth: depth + 1 });
  }

  expect(entries).toHaveLength(500);
  expect(ids.size).toBe(500);
  expect(maxDepth).toBe(5);
  return objects;
}

test('opens a deterministic 500-node primary tree from browser storage', async ({ page }) => {
  const map = createLargeMap();
  const objects = assertWorkload(map);
  const freshMap = createLargeMap();
  expect(freshMap).toStrictEqual(map);
  for (const object of assertWorkload(freshMap)) expect(objects.has(object)).toBe(false);

  const noise: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      noise.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    noise.push(`pageerror: ${String(error)}`);
  });

  await seedRecords(page, [envelopeOf(map)]);
  await page.goto(`/maps/${map.id}`);
  await expect(page.getByTestId('map-editor-ready')).toBeVisible();
  await expect(page.getByTestId('editor-title')).toHaveText(map.title);
  const nodes = page.locator('.react-flow__node');
  const viewport = page.locator('.react-flow__viewport');
  const zoom = () =>
    viewport.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
  await expect(nodes).toHaveCount(500);
  await expect.poll(zoom).toBe(0.25);

  const canvas = await page.locator('.react-flow').boundingBox();
  const root = await page.locator('[data-id="large-map-root"]').boundingBox();
  if (canvas === null || root === null) throw new Error('missing canvas or primary root');
  const bounds = await nodes.evaluateAll((elements) => {
    const boxes = elements.map((element) => element.getBoundingClientRect());
    return {
      left: Math.min(...boxes.map((box) => box.left)),
      top: Math.min(...boxes.map((box) => box.top)),
      right: Math.max(...boxes.map((box) => box.right)),
      bottom: Math.max(...boxes.map((box) => box.bottom)),
      visible: elements.filter((element) => getComputedStyle(element).visibility === 'visible')
        .length,
    };
  });
  expect(bounds.visible).toBe(500);
  expect(bounds.bottom - bounds.top).toBeGreaterThan(canvas.height);
  expect((bounds.left + bounds.right) / 2).toBeCloseTo(canvas.x + canvas.width / 2, 0);
  expect((bounds.top + bounds.bottom) / 2).toBeCloseTo(canvas.y + canvas.height / 2, 0);
  expect(root.x).toBeGreaterThan(canvas.x);
  expect(root.y).toBeGreaterThan(canvas.y);
  expect(root.x + root.width).toBeLessThan(canvas.x + canvas.width);
  expect(root.y + root.height).toBeLessThan(canvas.y + canvas.height);
  await page.mouse.move(canvas.x + 20, canvas.y + 20);
  await page.mouse.wheel(0, 1000);
  expect(await zoom()).toBe(0.25);
  await page.screenshot({ path: `${EVIDENCE}/large-map.png` });
  expect(noise).toEqual([]);
});

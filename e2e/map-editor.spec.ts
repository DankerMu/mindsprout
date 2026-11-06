import { expect, test, type Locator, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import { envelopeOf, readRecord, seedRecords, type RawRecord } from './support/seed';
import { edgeGeometry, expectEdgesOnHandles, type Box } from './support/canvas-geometry';

// The /maps/[id] editor route against `pnpm dev` (design "Fixture — issue #16"). Maps are seeded
// as raw records through the browser's real IndexedDB; every scenario fails on any console error
// or warning (React Flow's dev warnings go to console.warn) and on any uncaught page error.

const EVIDENCE = '.run/ui-evidence';
fs.mkdirSync(EVIDENCE, { recursive: true });

const NOT_FOUND = '找不到这张导图';
const FUTURE_VERSION = '此导图由更新版本创建';
const UNREADABLE = '无法打开这张导图';
const BACK = '返回导图列表';
const CREATED_AT = '2026-11-05T09:00:00.000Z';
const UPDATED_AT = '2026-11-05T10:00:00.000Z';

interface SeedNode {
  id: string;
  text: string;
  position?: { x: number; y: number };
  children: SeedNode[];
}

function leaf(id: string, text: string): SeedNode {
  return { id, text, children: [] };
}

function mapOf(id: string, title: string, roots: SeedNode[]) {
  return { id, title, roots, createdAt: CREATED_AT, updatedAt: UPDATED_AT };
}

// 根节点B ─ (子节点一, 子节点二)          浮动主题 @ (300, 200) ─ 浮动子节点
const SEEDED = mapOf('seeded', '标题A', [
  { id: 'root', text: '根节点B', children: [leaf('c1', '子节点一'), leaf('c2', '子节点二')] },
  {
    id: 'float',
    text: '浮动主题',
    position: { x: 300, y: 200 },
    children: [leaf('fc', '浮动子节点')],
  },
]);
const SEEDED_EDGES = [
  { source: 'root', target: 'c1' },
  { source: 'root', target: 'c2' },
  { source: 'float', target: 'fc' },
];

// A floating subtree far outside the 1280×720 viewport but within about 4× of it (#9 handoff).
const FAR = mapOf('far', '远方', [
  { id: 'root', text: '中心', children: [leaf('c1', '近处')] },
  {
    id: 'far',
    text: '远方主题',
    position: { x: 1600, y: 900 },
    children: [leaf('fc', '远方子节点')],
  },
]);

// A floating root without a position: layoutForest throws while the canvas renders.
const CORRUPT = mapOf('corrupt', '损坏', [
  { id: 'root', text: '根', children: [] },
  { id: 'lost', text: '无位置', children: [] },
]);

interface ConsoleRecord {
  noise: string[];
}

// Records every console error / warning and every uncaught page error, as "<type>: <text>".
function watchConsole(page: Page): ConsoleRecord {
  const record: ConsoleRecord = { noise: [] };
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      record.noise.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    record.noise.push(`pageerror: ${String(error)}`);
  });
  return record;
}

async function capture(page: Page, scenario: string): Promise<void> {
  await page.screenshot({ path: `${EVIDENCE}/${scenario}.png` });
}

async function openSeeded(page: Page, records: readonly RawRecord[], id: string): Promise<void> {
  await seedRecords(page, records);
  await page.goto(`/maps/${id}`);
}

// The record must still be exactly the seed after a second: opening is never an edit.
async function expectUnmodified(page: Page, record: RawRecord): Promise<void> {
  await page.waitForTimeout(1000);
  expect(await readRecord(page, record.key)).toStrictEqual(record.value);
}

const NUMBER = String.raw`(-?[\d.]+(?:e[-+]?\d+)?)`;
const TRANSLATE = new RegExp(String.raw`translate\(\s*${NUMBER}px\s*,\s*${NUMBER}px\s*\)`);
const SCALE = new RegExp(String.raw`scale\(\s*${NUMBER}\s*\)`);

function numbersIn(pattern: RegExp, transform: string): number[] {
  const match = pattern.exec(transform);
  if (match === null) throw new Error(`no ${pattern.source} in "${transform}"`);
  return match.slice(1).map(Number);
}

function nodeAt(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}

// A node's flow-coordinate position, parsed from React Flow's wrapper transform.
async function flowPosition(page: Page, id: string): Promise<{ x: number; y: number }> {
  const transform = await nodeAt(page, id).evaluate((element) => element.style.transform);
  const [x = Number.NaN, y = Number.NaN] = numbersIn(TRANSLATE, transform);
  return { x, y };
}

async function viewport(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  const transform = await page
    .locator('.react-flow__viewport')
    .evaluate((element) => element.style.transform);
  const [x = Number.NaN, y = Number.NaN] = numbersIn(TRANSLATE, transform);
  const [zoom = Number.NaN] = numbersIn(SCALE, transform);
  return { x, y, zoom };
}

async function boxesOf(page: Page): Promise<Box[]> {
  return page
    .locator('.react-flow__node')
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().toJSON() as Box),
    );
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function inside(box: Box, frame: Box): boolean {
  return (
    box.x >= frame.x &&
    box.y >= frame.y &&
    box.x + box.width <= frame.x + frame.width &&
    box.y + box.height <= frame.y + frame.height
  );
}

async function canvasFrame(page: Page): Promise<Box> {
  const frame = await page.locator('.react-flow').boundingBox();
  if (frame === null) throw new Error('the canvas has no box');
  return frame;
}

async function expectEditorReady(page: Page, title: string): Promise<void> {
  await expect(page.getByTestId('map-editor-ready')).toBeVisible();
  await expect(page.getByTestId('editor-title')).toHaveText(title);
}

// Wheels over the pane until the scale stops changing; returns the final scale.
async function wheelUntilStable(page: Page, deltaY: number): Promise<number> {
  let previous = (await viewport(page)).zoom;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(50);
    const current = (await viewport(page)).zoom;
    if (current === previous) return current;
    previous = current;
  }
  throw new Error(`the scale never settled (last ${String(previous)})`);
}

test.describe('map editor route /maps/[id]', () => {
  test('stale link shows not-found with a link back to the library', async ({ page }) => {
    const log = watchConsole(page);

    await page.goto('/maps/does-not-exist');
    await expect(page.getByText(NOT_FOUND)).toBeVisible();
    await capture(page, 'map-editor-stale-link');
    await page.getByRole('link', { name: BACK }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('app-ready')).toBeVisible();
    expect(log.noise).toStrictEqual([]);
  });

  test('future version shows its message and leaves the record untouched', async ({ page }) => {
    const log = watchConsole(page);
    const record = envelopeOf({ ...mapOf('v2', '新版本导图', [leaf('root', '根')]) }, 2);

    await openSeeded(page, [record], 'v2');
    await expect(page.getByText(FUTURE_VERSION)).toBeVisible();
    await expect(page.getByRole('link', { name: BACK })).toHaveAttribute('href', '/');
    await capture(page, 'map-editor-future-version');

    await expectUnmodified(page, record);
    expect(log.noise).toStrictEqual([]);
  });

  test('seeded render shows the map as stored, measured and unmodified', async ({ page }) => {
    const log = watchConsole(page);
    const record = envelopeOf(SEEDED);

    await openSeeded(page, [record], SEEDED.id);
    await expectEditorReady(page, '标题A');

    expect(await flowPosition(page, 'root')).toStrictEqual({ x: 0, y: 0 });
    expect(await flowPosition(page, 'float')).toStrictEqual({ x: 300, y: 200 });
    for (const id of ['root', 'c1', 'c2', 'float', 'fc']) {
      await expect(nodeAt(page, id)).toBeVisible();
    }
    await expect(nodeAt(page, 'root')).toHaveText('根节点B');
    await expect(async () => {
      const boxes = await boxesOf(page);
      expect(boxes).toHaveLength(5);
      const overlapping = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => overlaps(a, b)));
      expect(overlapping).toStrictEqual([]);
      for (const geometry of await edgeGeometry(page, SEEDED_EDGES)) {
        expectEdgesOnHandles(geometry);
      }
    }).toPass();
    await capture(page, 'map-editor-seeded-render');

    await expectUnmodified(page, record);
    expect(log.noise).toStrictEqual([]);
  });

  test('fit to content frames a far floating subtree', async ({ page }) => {
    const log = watchConsole(page);

    await openSeeded(page, [envelopeOf(FAR)], FAR.id);
    await expectEditorReady(page, '远方');
    for (const id of ['root', 'c1', 'far', 'fc']) await expect(nodeAt(page, id)).toBeVisible();
    const frame = await canvasFrame(page);
    expect((await boxesOf(page)).some((box) => !inside(box, frame))).toBe(true);

    await page.getByRole('button', { name: '适应画布' }).click();

    await expect(async () => {
      const boxes = await boxesOf(page);
      expect(boxes).toHaveLength(4);
      expect(boxes.filter((box) => !inside(box, frame))).toStrictEqual([]);
    }).toPass();
    await capture(page, 'map-editor-fit-to-content');
    expect(log.noise).toStrictEqual([]);
  });

  test('wheel zoom clamps between 25% and 200%', async ({ page }) => {
    const log = watchConsole(page);

    await openSeeded(page, [envelopeOf(SEEDED)], SEEDED.id);
    await expectEditorReady(page, '标题A');
    const frame = await canvasFrame(page);
    // Over the empty pane, away from every node.
    await page.mouse.move(frame.x + frame.width - 100, frame.y + frame.height - 100);

    expect(await wheelUntilStable(page, -400)).toBe(2);
    expect(await wheelUntilStable(page, 400)).toBe(0.25);
    await capture(page, 'map-editor-zoom-clamps');
    expect(log.noise).toStrictEqual([]);
  });

  test('space-drag pans the canvas without moving or selecting nodes', async ({ page }) => {
    const log = watchConsole(page);
    const ids = ['root', 'c1', 'c2', 'float', 'fc'];

    await openSeeded(page, [envelopeOf(SEEDED)], SEEDED.id);
    await expectEditorReady(page, '标题A');
    for (const id of ids) await expect(nodeAt(page, id)).toBeVisible();
    const before = await viewport(page);
    const positions = await Promise.all(ids.map((id) => flowPosition(page, id)));
    const box = await nodeAt(page, 'float').boundingBox();
    if (box === null) throw new Error('the floating root has no box');
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    await page.keyboard.down('Space');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 100, from.y, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Space');

    const after = await viewport(page);
    expect(Math.abs(after.x - before.x - 100)).toBeLessThanOrEqual(1);
    expect(after.y).toBe(before.y);
    expect(await Promise.all(ids.map((id) => flowPosition(page, id)))).toStrictEqual(positions);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
    await capture(page, 'map-editor-space-drag-pan');
    expect(log.noise).toStrictEqual([]);
  });

  test('corrupt record shows the error state and leaves the record untouched', async ({ page }) => {
    const log = watchConsole(page);
    const record = envelopeOf(CORRUPT);

    await openSeeded(page, [record], CORRUPT.id);
    await expect(page.getByText(UNREADABLE)).toBeVisible();
    await expect(page.getByRole('link', { name: BACK })).toHaveAttribute('href', '/');
    await expect(page.getByText(NOT_FOUND)).toHaveCount(0);
    await capture(page, 'map-editor-corrupt-record');

    await expectUnmodified(page, record);
    // Only the caught layout error may be reported, and it must have been.
    const expected = (line: string) =>
      line.startsWith('error: ') && line.includes('has no finite position');
    expect(log.noise.filter((line) => !expected(line))).toStrictEqual([]);
    expect(log.noise.some(expected)).toBe(true);
  });
});

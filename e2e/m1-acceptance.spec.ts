import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import type { MindMap, MindNode } from '../src/contexts/map/domain/types';
import { edgeGeometry, expectEdgesOnHandles } from './support/canvas-geometry';
import { readRecord, seedRecords } from './support/seed';

const EVIDENCE = '.run/ui-evidence';
const NOW = '2026-11-07T12:34:56.789Z';
const NOTE = '  **Literal** <b>note</b>\n第二行保留空格  ';
fs.mkdirSync(EVIDENCE, { recursive: true });

const nodeAt = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const titleInput = (page: Page) => page.getByRole('textbox', { name: '节点标题' });
const noteInput = (page: Page) => page.getByRole('textbox', { name: '节点备注' });
const fit = (page: Page) => page.getByRole('button', { name: '适应画布' }).click();

async function createChild(page: Page, parentId: string, text: string): Promise<string> {
  await fit(page);
  await nodeAt(page, parentId).click();
  await page.keyboard.press('Tab');
  await expect(titleInput(page)).toBeFocused();
  await expect(titleInput(page)).toHaveValue('');
  const selected = page.locator('.react-flow__node.selected');
  await expect(selected).toHaveCount(1);
  await expect(selected.getByRole('textbox')).toBeFocused();
  const id = await selected.getAttribute('data-id');
  if (id === null) throw new Error('created node has no public id');
  await titleInput(page).fill(text);
  await titleInput(page).press('Enter');
  await expect(titleInput(page)).toHaveCount(0);
  await expect(nodeAt(page, id).getByRole('button', { name: text, exact: true })).toBeVisible();
  return id;
}

async function expectTreeUi(
  page: Page,
  labels: readonly (readonly [string, string])[],
  edges: readonly { source: string; target: string }[],
) {
  await expect(page.getByTestId('editor-title')).toHaveText('新导图');
  await expect(page.locator('.react-flow__node')).toHaveCount(labels.length);
  for (const [id, text] of labels) {
    await expect(nodeAt(page, id).getByRole('button', { name: text, exact: true })).toBeVisible();
  }
  await expect(page.locator('.react-flow__edge')).toHaveCount(edges.length);
  await expect(async () => {
    for (const edge of await edgeGeometry(page, edges)) expectEdgesOnHandles(edge);
  }).toPass();
}

async function flowPosition(page: Page, id: string) {
  return nodeAt(page, id).evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f };
  });
}

async function expectNote(page: Page, id: string) {
  await nodeAt(page, id).click();
  await expect(noteInput(page)).toHaveValue(NOTE);
  await expect(nodeAt(page, id).getByRole('img', { name: '有备注' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '备注' }).locator('b, strong')).toHaveCount(
    0,
  );
}

test('M1 acceptance — create, edit, reparent, detach and reload a complete map', async ({
  page,
}) => {
  const noise: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      noise.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    noise.push(`pageerror: ${String(error)}`);
  });
  await page.clock.setFixedTime(new Date(NOW));
  await seedRecords(page, []);
  await page.goto('/');
  await expect(page.getByTestId('app-ready')).toBeVisible();
  await expect(page.getByText('还没有导图')).toBeVisible();
  await page.getByRole('button', { name: '新建导图' }).click();
  await expect(page).toHaveURL(/\/maps\/[^/?#]+$/);
  await expect(page.getByTestId('map-editor-ready')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  const mapId = new URL(page.url()).pathname.slice('/maps/'.length);
  const rootId = await page.locator('.react-flow__node').getAttribute('data-id');
  if (rootId === null) throw new Error('primary root has no public id');
  const expectedEnvelope = (roots: readonly unknown[]) => ({
    schemaVersion: 1,
    map: { id: mapId, title: '新导图', createdAt: NOW, updatedAt: NOW, roots },
  });
  await expect
    .poll(() => readRecord(page, mapId))
    .toStrictEqual(expectedEnvelope([{ id: rootId, text: '新导图', children: [] }]));

  const aId = await createChild(page, rootId, '分支 A');
  const bId = await createChild(page, rootId, '分支 B');
  const cId = await createChild(page, aId, '后代 C');
  await fit(page);
  await nodeAt(page, aId).click();
  await page.keyboard.press('F2');
  await expect(nodeAt(page, aId).getByRole('textbox')).toBeFocused();
  await expect(titleInput(page)).toHaveValue('分支 A');
  await titleInput(page).fill('重命名 A');
  await titleInput(page).press('Enter');
  await expect(titleInput(page)).toHaveCount(0);
  await fit(page);
  await nodeAt(page, cId).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑备注', exact: true }).click();
  await expect(noteInput(page)).toBeFocused();
  await noteInput(page).fill(NOTE);
  await expect(noteInput(page)).toHaveValue(NOTE);
  await nodeAt(page, aId).click();
  await expect(noteInput(page)).not.toBeFocused();

  const descendant: MindNode = { id: cId, text: '后代 C', note: NOTE, children: [] };
  const branch: MindNode = { id: aId, text: '重命名 A', children: [descendant] };
  const sibling: MindNode = { id: bId, text: '分支 B', children: [] };
  const labels = [
    [rootId, '新导图'],
    [aId, '重命名 A'],
    [bId, '分支 B'],
    [cId, '后代 C'],
  ] as const;
  await expect
    .poll(() => readRecord(page, mapId))
    .toStrictEqual(expectedEnvelope([{ id: rootId, text: '新导图', children: [branch, sibling] }]));

  await fit(page);
  await nodeAt(page, aId).dragTo(nodeAt(page, bId));
  const reparented = expectedEnvelope([
    { id: rootId, text: '新导图', children: [{ ...sibling, children: [branch] }] },
  ]);
  await expect.poll(() => readRecord(page, mapId)).toStrictEqual(reparented);
  await fit(page);
  await expectTreeUi(page, labels, [
    { source: rootId, target: bId },
    { source: bId, target: aId },
    { source: aId, target: cId },
  ]);
  await expectNote(page, cId);
  await page.screenshot({ path: `${EVIDENCE}/m1-acceptance-reparented.png`, fullPage: true });

  await nodeAt(page, aId).click();
  await fit(page);
  const pane = page.locator('.react-flow__pane');
  const emptyPoint = await pane.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const point = { x: 120, y: box.height - 120 };
    if (document.elementFromPoint(box.x + point.x, box.y + point.y) !== element) {
      throw new Error('detach destination is not empty canvas');
    }
    return point;
  });
  await nodeAt(page, aId).dragTo(pane, { targetPosition: emptyPoint });
  const finalForest = (position: { x: unknown; y: unknown }) => [
    { id: rootId, text: '新导图', children: [sibling] },
    { ...branch, position },
  ];
  await expect
    .poll(() => readRecord(page, mapId))
    .toStrictEqual(expectedEnvelope(finalForest({ x: expect.any(Number), y: expect.any(Number) })));
  const committed = (await readRecord(page, mapId)) as { map: MindMap };
  const committedPosition = committed.map.roots[1]?.position;
  if (committedPosition === undefined) throw new Error('floating root has no saved position');
  expect(Number.isFinite(committedPosition.x)).toBe(true);
  expect(Number.isFinite(committedPosition.y)).toBe(true);
  const finalEnvelope = expectedEnvelope(finalForest(committedPosition));
  await expect.poll(() => readRecord(page, mapId)).toStrictEqual(finalEnvelope);
  await fit(page);
  const finalEdges = [
    { source: rootId, target: bId },
    { source: aId, target: cId },
  ];
  await expectTreeUi(page, labels, finalEdges);
  await expectNote(page, cId);
  // Separate exact round-trip witnesses; pointer-to-flow accuracy belongs to the drag suite.
  const renderedPosition = await flowPosition(page, aId);
  const beforeReload = await readRecord(page, mapId);
  expect(beforeReload).toStrictEqual(finalEnvelope);
  const undo = page.getByRole('button', { name: '撤销', exact: true });
  const redo = page.getByRole('button', { name: '重做', exact: true });
  await expect(undo).toBeEnabled();
  await page.screenshot({ path: `${EVIDENCE}/m1-acceptance-detached.png`, fullPage: true });

  await page.reload();
  await expect(page.getByTestId('map-editor-ready')).toBeVisible();
  const afterReload = await readRecord(page, mapId);
  expect(afterReload).toStrictEqual(beforeReload);
  expect(afterReload).toStrictEqual(finalEnvelope);
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await fit(page);
  await expectTreeUi(page, labels, finalEdges);
  await expect.poll(() => flowPosition(page, aId)).toStrictEqual(renderedPosition);
  await expectNote(page, cId);
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await page.screenshot({ path: `${EVIDENCE}/m1-acceptance-reloaded.png`, fullPage: true });
  expect(noise).toEqual([]);
});

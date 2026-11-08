import { expect, type Page } from '@playwright/test';
import type { MindMap, MindNode } from '../../src/contexts/map/domain/types';
import { envelopeOf, readRecord, seedRecords } from './seed';

export const AA: MindNode = { id: 'aa', text: 'AA', children: [] };
export const AB: MindNode = {
  id: 'ab',
  text: 'AB',
  children: [
    { id: 'aba', text: 'ABA', children: [] },
    { id: 'abb', text: 'ABB', children: [] },
  ],
};
export const A: MindNode = { id: 'a', text: 'A', children: [AA, AB] };
export const B: MindNode = {
  id: 'b',
  text: 'B',
  children: [{ id: 'ba', text: 'BA', children: [] }],
};
export const C: MindNode = {
  id: 'c',
  text: 'C',
  children: [{ id: 'ca', text: 'CA', children: [] }],
};
export const ROOT: MindNode = { id: 'r', text: 'Root', children: [A, B, C] };
export const FC: MindNode = {
  id: 'fc',
  text: 'Detach C',
  children: [{ id: 'fd', text: 'Descendant', children: [] }],
};
export const FS: MindNode = { id: 'fs', text: 'Before C', children: [] };
export const F: MindNode = {
  id: 'f',
  // Empty text gives a font-independent 24px width and an exactly representable CSSOM position.
  text: '',
  position: { x: 700.25, y: 200.75 },
  children: [FS, FC],
};
export const MAP: MindMap = {
  id: 'context-menu',
  title: '节点菜单',
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  roots: [ROOT, F],
};
export const nodeAt = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`);
export const item = (page: Page, label: string) =>
  page.getByRole('menuitem', { name: label, exact: true });
export const undo = (page: Page) => page.getByRole('button', { name: '撤销', exact: true });
export const redo = (page: Page) => page.getByRole('button', { name: '重做', exact: true });

export async function open(page: Page, id: string) {
  await nodeAt(page, id).click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
}

export async function roots(page: Page) {
  const record = (await readRecord(page, MAP.id)) as { map: MindMap };
  return record.map.roots;
}

export async function restore(page: Page, expected = MAP.roots) {
  await expect(undo(page)).toBeEnabled();
  await undo(page).click();
  await expect(undo(page)).toBeDisabled();
  await expect.poll(() => roots(page)).toEqual(expected);
}

export async function loadMap(page: Page, map = MAP) {
  await seedRecords(page, [envelopeOf(map)]);
  await page.goto(`/maps/${map.id}`);
  await expect(page.getByTestId('map-editor-ready')).toBeVisible();
  await page.getByRole('button', { name: '适应画布' }).click();
  await expect(nodeAt(page, 'fd')).toBeVisible();
}

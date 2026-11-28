import { expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import type { MindMap, MindNode } from '../src/contexts/map/domain/types';
import { beginNativeMouseDrag, dropOn, position } from './support/canvas-geometry';
import { envelopeOf, readRecord, seedRecords } from './support/seed';
import { test } from './support/session';

// Canvas-layout motion ("Issue #312 Fixture Triage"). The default project prefers reduced motion;
// the motion describe opts in. CSS Module class names are hashed in `next dev`, so every assertion
// reads computed styles.

const EVIDENCE = '.run/ui-evidence';
fs.mkdirSync(EVIDENCE, { recursive: true });
const leaf = (id: string, text: string, children: MindNode[] = []): MindNode => ({
  id,
  text,
  children,
});
const mapOf = (id: string, root: MindNode): MindMap => ({
  id,
  title: id,
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  roots: [root],
});
const SIBLINGS = mapOf(
  'canvas-motion-siblings',
  leaf('r', '中心主题', [leaf('a', '甲'), leaf('b', '乙')]),
);
// The single-node-drag tree: dropping p onto s reorders the wrappers of the bystanders c and d.
const DRAG = mapOf(
  'canvas-motion-drag',
  leaf('r', '', [
    leaf('s', 'Sibling'),
    leaf('c', 'C', [leaf('d', 'D')]),
    leaf('p', 'P', [leaf('q', 'Q')]),
  ]),
);
const SIBLING_IDS = ['r', 'a', 'b'];

const nodeAt = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const inlineTransform = (page: Page, id: string) =>
  nodeAt(page, id).evaluate((element: HTMLElement) => element.style.transform);
const transitionDuration = (page: Page, id: string) =>
  nodeAt(page, id).evaluate((element) => getComputedStyle(element).transitionDuration);
const wrapperOrder = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map((node) => node.dataset.id),
  );

// Opens a seeded map and waits until every load-time fade and measured-size shift has finished.
async function open(page: Page, map: MindMap, last: string) {
  await seedRecords(page, [envelopeOf(map)]);
  await page.goto(`/maps/${map.id}`);
  await expect(page.getByTestId('map-editor-ready')).toBeVisible();
  await expect(nodeAt(page, last)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
}

// Selects `id` with the canvas focused and inserts an empty sibling below it in creation edit.
// A blur would delete the empty node, so callers assert before anything moves focus.
async function addSiblingBelow(page: Page, id: string) {
  await nodeAt(page, id).click();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: '节点标题' })).toBeFocused();
}

// Records the wrapper id of every animation that starts from now on. The returned reader waits two
// frames (an animationstart is dispatched a frame after the style change) and for every animation
// to finish, so a replayed 200 ms fade cannot slip past.
async function recordAnimationStarts(page: Page) {
  await page.evaluate(() => {
    const started: string[] = [];
    Object.assign(window, { animationStarts: started });
    document.addEventListener(
      'animationstart',
      (event) => {
        const wrapper = (event.target as Element).closest<HTMLElement>('.react-flow__node');
        if (wrapper?.dataset.id !== undefined) started.push(wrapper.dataset.id);
      },
      true,
    );
  });
  return async () => {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    return page.evaluate(
      () => (window as unknown as { animationStarts: string[] }).animationStarts,
    );
  };
}

// Resolves in the first animation frame where a node outside `known` exists, sampling that frame:
// b's computed and inline translations, b's transition duration and the new content's animation.
async function firstFrameOfNewNode(page: Page, known: readonly string[]) {
  const sample = await page.waitForFunction(
    (ids) => {
      const created = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].find(
        (node) => !ids.includes(node.dataset.id ?? ''),
      );
      const content = created?.querySelector('.mind-node');
      const sibling = document.querySelector<HTMLElement>('.react-flow__node[data-id="b"]');
      if (created === undefined || content == null || sibling === null) return false;
      const computed = new DOMMatrixReadOnly(getComputedStyle(sibling).transform);
      const inline = new DOMMatrixReadOnly(sibling.style.transform);
      const animation = getComputedStyle(content);
      return {
        id: created.dataset.id ?? '',
        computed: [computed.e, computed.f],
        inline: [inline.e, inline.f],
        inlineTransform: sibling.style.transform,
        duration: getComputedStyle(sibling).transitionDuration,
        animationName: animation.animationName,
        animationDuration: animation.animationDuration,
      };
    },
    known,
    { polling: 'raf' },
  );
  const value = await sample.jsonValue();
  if (value === false) throw new Error('waitForFunction resolved without a sample');
  return value;
}

function expectSameTranslation(sample: { computed: number[]; inline: number[] }) {
  expect(sample.computed).toHaveLength(2);
  sample.computed.forEach((value, index) => {
    expect(value).toBeCloseTo(sample.inline[index] ?? Number.NaN, 1);
  });
}

let noise: string[];
test.beforeEach(({ page }) => {
  noise = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') noise.push(message.text());
  });
  page.on('pageerror', (error) => {
    noise.push(String(error));
  });
});
test.afterEach(async ({ page }, info) => {
  await page.screenshot({
    path: `${EVIDENCE}/canvas-motion-${info.title.replaceAll(/[^a-zA-Z0-9]+/g, '-')}.png`,
  });
  expect(noise).toEqual([]);
});

test.describe('layout motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('Sibling shifts smoothly', async ({ page }) => {
    await open(page, SIBLINGS, 'b');
    const before = await inlineTransform(page, 'b');
    await addSiblingBelow(page, 'a');
    await expect.poll(() => inlineTransform(page, 'b')).not.toBe(before);
    const transition = await nodeAt(page, 'b').evaluate((element) => {
      const style = getComputedStyle(element);
      return { property: style.transitionProperty.split(', '), duration: style.transitionDuration };
    });
    expect(transition.property).toContain('transform');
    expect(transition.duration).toBe('0.2s');
    const settled = await page.waitForFunction(
      () => {
        const sibling = document.querySelector<HTMLElement>('.react-flow__node[data-id="b"]');
        if (sibling === null || sibling.getAnimations().length > 0) return false;
        const computed = new DOMMatrixReadOnly(getComputedStyle(sibling).transform);
        const inline = new DOMMatrixReadOnly(sibling.style.transform);
        return { computed: [computed.e, computed.f], inline: [inline.e, inline.f] };
      },
      undefined,
      { polling: 'raf' },
    );
    const value = await settled.jsonValue();
    if (value === false) throw new Error('waitForFunction resolved without a sample');
    expectSameTranslation(value);
  });

  test('New node fades in', async ({ page }) => {
    await open(page, SIBLINGS, 'b');
    const starts = await recordAnimationStarts(page);
    await nodeAt(page, 'a').click();
    const sample = firstFrameOfNewNode(page, SIBLING_IDS);
    await page.keyboard.press('Enter');
    const first = await sample;
    expect(first.animationName).not.toBe('none');
    expect(first.animationDuration).toBe('0.2s');
    const content = nodeAt(page, first.id).locator('.mind-node');
    await expect
      .poll(() => content.evaluate((element) => getComputedStyle(element).opacity))
      .toBe('1');
    expect(await starts()).toContain(first.id);
    await expect(page.getByRole('textbox', { name: '节点标题' })).toBeFocused();
  });

  test('A reordering drop does not fade the bystanders again', async ({ page }) => {
    await open(page, DRAG, 'q');
    expect(await wrapperOrder(page)).toEqual(['r', 's', 'c', 'd', 'p', 'q']);
    const starts = await recordAnimationStarts(page);
    await dropOn(page, 'p', 's');
    await expect.poll(() => wrapperOrder(page)).toEqual(['r', 's', 'p', 'q', 'c', 'd']);
    const started = await starts();
    expect(started).not.toContain('c');
    expect(started).not.toContain('d');
  });

  test('A click during a slide commits nothing', async ({ page }) => {
    const history = (name: string) => page.getByRole('button', { name, exact: true });
    await open(page, SIBLINGS, 'b');
    await nodeAt(page, 'a').click();
    await page.keyboard.press('Delete');
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    // Positive control: which wrapper the press landed on, and whether it was still sliding.
    await page.evaluate(() => {
      document.addEventListener(
        'mousedown',
        (event) => {
          const wrapper = (event.target as Element).closest<HTMLElement>('.react-flow__node');
          Object.assign(window, {
            pressed: [wrapper?.dataset.id, wrapper?.getAnimations().length],
          });
        },
        true,
      );
    });
    await page.keyboard.press('ControlOrMeta+z');
    const sliding = await page.waitForFunction(
      () => {
        const sibling = document.querySelector('.react-flow__node[data-id="b"]');
        if (sibling === null || sibling.getAnimations().length === 0) return false;
        const box = sibling.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      },
      undefined,
      { polling: 'raf' },
    );
    const point = await sliding.jsonValue();
    if (point === false) throw new Error('waitForFunction resolved without a sample');
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 1, point.y);
    await page.mouse.up();
    const pressed = await page.evaluate(
      () => (window as unknown as { pressed: unknown[] }).pressed,
    );
    expect(pressed[0]).toBe('b');
    expect(pressed[1]).toBeGreaterThan(0);
    await expect(history('撤销')).toBeDisabled();
    await expect(history('重做')).toBeEnabled();
    const roots = async () => ((await readRecord(page, SIBLINGS.id)) as { map: MindMap }).map.roots;
    await expect.poll(roots).toEqual(SIBLINGS.roots);
  });

  test('Drag preview is immediate', async ({ page }) => {
    await open(page, DRAG, 'q');
    expect(await transitionDuration(page, 'c')).toBe('0.2s');
    const origin = await position(page, 'c');
    const move = await beginNativeMouseDrag(page, origin);
    await move({ x: origin.x + 160, y: origin.y + 120 });
    expect(await transitionDuration(page, 'c')).toBe('0s');
    expect(await transitionDuration(page, 'd')).toBe('0s');
    await page.mouse.up();
    await expect.poll(() => transitionDuration(page, 'c')).toBe('0.2s');
  });
});

test.describe('reduced motion', () => {
  test('Reduced motion', async ({ page }) => {
    await open(page, SIBLINGS, 'b');
    const prefers = await page.evaluate(
      () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    expect(prefers).toBe(true);
    const before = await inlineTransform(page, 'b');
    await nodeAt(page, 'a').click();
    const sample = firstFrameOfNewNode(page, SIBLING_IDS);
    await page.keyboard.press('Enter');
    const first = await sample;
    expect(first.inlineTransform).not.toBe(before);
    expectSameTranslation(first);
    expect(first.duration).toBe('0s');
    expect(first.animationName).toBe('none');
    await expect(page.getByRole('textbox', { name: '节点标题' })).toBeFocused();
  });
});

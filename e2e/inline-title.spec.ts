import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import { edgeGeometry, expectEdgesOnHandles } from './support/canvas-geometry';
import { envelopeOf, readRecord, seedRecords } from './support/seed';

const EVIDENCE = '.run/ui-evidence';
fs.mkdirSync(EVIDENCE, { recursive: true });
const MAP = {
  id: 'inline-title',
  title: '导图标题不随节点改名',
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  roots: [
    {
      id: 'r',
      text: '中心主题',
      children: [
        { id: 'a', text: '主题甲', children: [] },
        { id: 'b', text: '主题乙', children: [] },
        { id: 'c', text: '主题丙', children: [] },
      ],
    },
  ],
};
const RECORD = envelopeOf(MAP);
const nodeAt = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const inputAt = (page: Page) => page.getByRole('textbox', { name: '节点标题' });

async function expectTitles(page: Page, changed: Record<string, string> = {}) {
  for (const [id, title] of Object.entries({
    r: '中心主题',
    a: '主题甲',
    b: '主题乙',
    c: '主题丙',
    ...changed,
  })) {
    await expect(nodeAt(page, id).locator('.mind-node')).toHaveAttribute('aria-label', title);
    await expect(nodeAt(page, id)).toHaveText(title);
  }
  await expect(page.getByTestId('editor-title')).toHaveText(MAP.title);
}

async function capture(page: Page, name: string) {
  await page.screenshot({ path: `${EVIDENCE}/inline-title-${name}.png` });
}

function watchRenameVisibility(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const nodes = [...document.querySelectorAll<HTMLElement>('.react-flow__node')];
        const hidden = new Set<string>();
        const check = () => {
          for (const node of nodes) {
            if (!node.isConnected || getComputedStyle(node).visibility === 'hidden') {
              hidden.add(node.dataset.id ?? 'missing id');
            }
          }
        };
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            if (record.oldValue?.includes('visibility: hidden') === true)
              hidden.add('hidden style');
          }
          check();
        });
        for (const node of nodes)
          observer.observe(node, {
            attributes: true,
            attributeFilter: ['style'],
            attributeOldValue: true,
          });
        document.addEventListener(
          'keydown',
          () => {
            let frames = 0;
            const sample = () => {
              check();
              frames += 1;
              if (frames < 24) requestAnimationFrame(sample);
              else {
                observer.disconnect();
                resolve([...hidden]);
              }
            };
            requestAnimationFrame(sample);
          },
          { once: true },
        );
      }),
  );
}

test.describe('inline title editing', () => {
  let noise: string[];
  test.beforeEach(async ({ page }) => {
    noise = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        noise.push(`${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      noise.push(`pageerror: ${String(error)}`);
    });
    await seedRecords(page, [RECORD]);
    await page.goto('/maps/inline-title');
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    for (const id of ['r', 'a', 'b', 'c']) await expect(nodeAt(page, id)).toBeVisible();
    await page.getByRole('button', { name: '适应画布' }).click();
  });
  test.afterEach(() => {
    expect(noise).toEqual([]);
  });

  test('Commit a rename', async ({ page }) => {
    await nodeAt(page, 'a').dblclick();
    await expect(inputAt(page)).toBeFocused();
    await inputAt(page).fill('新想法');
    await capture(page, 'editing');
    await inputAt(page).press('Enter');
    await expect(inputAt(page)).toHaveCount(0);
    await expect(page.getByRole('region')).toBeFocused();
    await expectTitles(page, { a: '新想法' });
    await capture(page, 'commit');
  });

  test('Escape discards', async ({ page }) => {
    await nodeAt(page, 'a').dblclick();
    await inputAt(page).fill('不应保存的草稿');
    await inputAt(page).press('Escape');
    await expect(inputAt(page)).toHaveCount(0);
    await expect(page.getByRole('region')).toBeFocused();
    await expectTitles(page);
    await page.waitForTimeout(600);
    expect(await readRecord(page, MAP.id)).toEqual(RECORD.value);
    await capture(page, 'escape');
  });

  test('Long title', async ({ page }) => {
    const text = '长'.repeat(200);
    const edges = [
      { source: 'r', target: 'a' },
      { source: 'r', target: 'b' },
      { source: 'r', target: 'c' },
    ];
    await expect(async () => {
      for (const geometry of await edgeGeometry(page, edges)) expectEdgesOnHandles(geometry);
    }).toPass();
    const before = await edgeGeometry(page, edges);
    await nodeAt(page, 'r').dblclick();
    await inputAt(page).fill(text);
    const watching = watchRenameVisibility(page);
    await inputAt(page).press('Enter');
    expect(await watching).toEqual([]);
    await expectTitles(page, { r: text });
    await expect(async () => {
      const after = await edgeGeometry(page, edges);
      for (const geometry of after) expectEdgesOnHandles(geometry);
      const original = before[0];
      const renamed = after[0];
      if (original === undefined || renamed === undefined) throw new Error('missing edge geometry');
      expect(renamed.source.node.width).toBeGreaterThan(original.source.node.width * 2);
      expect(renamed.start.x).toBeGreaterThan(original.start.x + 100);
      expect(renamed.end.x).toBeGreaterThan(original.end.x + 100);
    }).toPass();
    fs.writeFileSync(
      `${EVIDENCE}/inline-title-geometry.json`,
      JSON.stringify(
        { before, after: await edgeGeometry(page, edges), hiddenDuringRename: [] },
        null,
        2,
      ),
    );
    await capture(page, 'long');
  });

  test('Rename with three nodes selected', async ({ page }) => {
    await nodeAt(page, 'a').click();
    await nodeAt(page, 'b').click({ modifiers: ['Shift'] });
    await nodeAt(page, 'c').click({ modifiers: ['Shift'] });
    const selected = () =>
      page
        .locator('.react-flow__node.selected')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')).sort());
    expect(await selected()).toEqual(['a', 'b', 'c']);
    await page.keyboard.press('F2');
    await expect(inputAt(page)).toHaveCount(1);
    await expect(nodeAt(page, 'c').getByRole('textbox')).toBeFocused();
    expect(await selected()).toEqual(['a', 'b', 'c']);
    await inputAt(page).fill('只改主选');
    await inputAt(page).press('Enter');
    expect(await selected()).toEqual(['a', 'b', 'c']);
    await expectTitles(page, { c: '只改主选' });
    await capture(page, 'three-selected');
  });

  test('Blur commits without stealing destination focus', async ({ page }) => {
    await nodeAt(page, 'b').dblclick();
    await inputAt(page).fill('失焦保存');
    const destination = page.getByRole('button', { name: '适应画布' });
    await destination.click();
    await expect(destination).toBeFocused();
    await expect(inputAt(page)).toHaveCount(0);
    await expectTitles(page, { b: '失焦保存' });
    await capture(page, 'blur');
  });

  test('Edits older than the save window survive reload', async ({ page }) => {
    await nodeAt(page, 'a').dblclick();
    await inputAt(page).fill('窗口外已保存');
    const waitMs = await inputAt(page).evaluate(async (input) => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      const start = performance.now();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 600);
      });
      return performance.now() - start;
    });
    expect(waitMs).toBeGreaterThanOrEqual(600);
    await nodeAt(page, 'b').dblclick();
    await inputAt(page).fill('窗口内不作保证');
    await Promise.all([
      page.waitForEvent('load'),
      inputAt(page).evaluate(async (input) => {
        const commit = performance.now();
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        );
        await Promise.resolve();
        const title = document
          .querySelector('.react-flow__node[data-id="b"] .mind-node')
          ?.getAttribute('aria-label');
        if (title !== '窗口内不作保证')
          throw new Error('second rename did not commit before reload');
        window.addEventListener(
          'beforeunload',
          () => {
            sessionStorage.setItem('inline-title-reload-ms', String(performance.now() - commit));
          },
          { once: true },
        );
        location.reload();
      }),
    ]);
    await expect(page.getByTestId('map-editor-ready')).toBeVisible();
    const reloadMs = await page.evaluate(() =>
      Number(sessionStorage.getItem('inline-title-reload-ms')),
    );
    expect(reloadMs).toBeGreaterThan(0);
    expect(reloadMs).toBeLessThan(100);
    await expect(nodeAt(page, 'a')).toHaveText('窗口外已保存');
    await expect(nodeAt(page, 'r')).toHaveText('中心主题');
    await expect(nodeAt(page, 'c')).toHaveText('主题丙');
    await expect(page.getByTestId('editor-title')).toHaveText(MAP.title);
    expect(await readRecord(page, MAP.id)).toMatchObject({
      map: {
        title: MAP.title,
        roots: [
          {
            id: 'r',
            text: '中心主题',
            children: [{ id: 'a', text: '窗口外已保存' }, { id: 'b' }, { id: 'c', text: '主题丙' }],
          },
        ],
      },
    });
    fs.writeFileSync(
      `${EVIDENCE}/inline-title-persistence-timing.json`,
      JSON.stringify({ waitMs, reloadMs }, null, 2),
    );
    await capture(page, 'reload');
  });
});

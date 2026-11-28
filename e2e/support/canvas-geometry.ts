import { expect, type Page } from '@playwright/test';
import type { Position } from '../../src/contexts/map/domain/types';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function nativeCanvasPointer(page: Page) {
  const { x, y, zoom } = await page.locator('.react-flow__viewport').evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    const canvas = element.closest('.react-flow');
    if (canvas === null) throw new Error('missing canvas');
    const box = canvas.getBoundingClientRect();
    return { x: box.x + matrix.e, y: box.y + matrix.f, zoom: matrix.a };
  });
  return {
    at: (point: Position): Position => ({
      x: Math.round(x + point.x * zoom),
      y: Math.round(y + point.y * zoom),
    }),
    // Subtract the actual input pixels first: canvas origin and pan cancel.
    displacement: (from: Position, to: Position): Position => ({
      x: (to.x - from.x) / zoom,
      y: (to.y - from.y) / zoom,
    }),
  };
}

export async function beginNativeMouseDrag(page: Page, origin: Position) {
  const pointer = await nativeCanvasPointer(page);
  const grab = pointer.at({ x: origin.x + 20, y: origin.y + 10 });
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  return async (point: Position): Promise<Position> => {
    const destination = pointer.at(point);
    await page.mouse.move(destination.x, destination.y, { steps: 12 });
    return pointer.displacement(grab, destination);
  };
}

// A node wrapper's rendered flow position.
export async function position(page: Page, id: string): Promise<Position> {
  return page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f };
  });
}

export async function dropOn(page: Page, id: string, target: string) {
  const destination = await position(page, target);
  const move = await beginNativeMouseDrag(page, await position(page, id));
  await move({ x: destination.x + 20, y: destination.y + 10 });
  await page.mouse.up();
}

export function translated(origin: Position, displacement: Position): Position {
  return { x: origin.x + displacement.x, y: origin.y + displacement.y };
}

export async function panAcrossCanvas(page: Page, direction: 'left' | 'right') {
  const canvas = await page.getByRole('region', { name: '思维导图画布' }).boundingBox();
  if (canvas === null) throw new Error('missing canvas');
  const left = Math.round(canvas.x + 20);
  const right = Math.round(canvas.x + canvas.width - 20);
  const y = Math.round(canvas.y + canvas.height - 60);
  await page.mouse.move(direction === 'left' ? right : left, y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(direction === 'left' ? left : right, y, { steps: 10 });
  await page.mouse.up({ button: 'middle' });
  return canvas;
}

interface EdgeGeometry {
  start: { x: number; y: number };
  end: { x: number; y: number };
  source: { handle: Box; node: Box };
  target: { handle: Box; node: Box };
}

// Screen coordinates of each edge path's ends and of its handles and nodes.
export async function edgeGeometry(
  page: Page,
  edges: readonly { source: string; target: string }[],
): Promise<EdgeGeometry[]> {
  return page.evaluate((pairs) => {
    const boxOf = (selector: string) => {
      const element = document.querySelector(selector);
      if (element === null) throw new Error(`missing ${selector}`);
      return element.getBoundingClientRect().toJSON() as Box;
    };
    const ends = (target: string) => {
      const path = document.querySelector<SVGPathElement>(
        `.react-flow__edge[data-id="${target}"] path.react-flow__edge-path`,
      );
      if (path === null) throw new Error(`edge ${target} has no path`);
      const matrix = path.getScreenCTM();
      if (matrix === null) throw new Error(`edge ${target} is not on screen`);
      const onScreen = (length: number) => {
        const { x, y } = path.getPointAtLength(length).matrixTransform(matrix);
        return { x, y };
      };
      return { start: onScreen(0), end: onScreen(path.getTotalLength()) };
    };
    return pairs.map(({ source, target }) => ({
      ...ends(target),
      source: {
        handle: boxOf(`.react-flow__node[data-id="${source}"] .react-flow__handle.source`),
        node: boxOf(`.react-flow__node[data-id="${source}"]`),
      },
      target: {
        handle: boxOf(`.react-flow__node[data-id="${target}"] .react-flow__handle.target`),
        node: boxOf(`.react-flow__node[data-id="${target}"]`),
      },
    }));
  }, edges);
}

function middleY(box: Box): number {
  return box.y + box.height / 2;
}

// Edges meet the measured handles' outer sides; each handle is centred on its node's side.
export function expectEdgesOnHandles(geometry: EdgeGeometry): void {
  const { start, end, source, target } = geometry;
  expect(Math.abs(start.x - (source.handle.x + source.handle.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(start.y - middleY(source.handle))).toBeLessThanOrEqual(1);
  expect(Math.abs(end.x - target.handle.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(end.y - middleY(target.handle))).toBeLessThanOrEqual(1);
  const sourceCentreX = source.handle.x + source.handle.width / 2;
  const targetCentreX = target.handle.x + target.handle.width / 2;
  expect(Math.abs(sourceCentreX - (source.node.x + source.node.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(middleY(source.handle) - middleY(source.node))).toBeLessThanOrEqual(1);
  expect(Math.abs(targetCentreX - target.node.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(middleY(target.handle) - middleY(target.node))).toBeLessThanOrEqual(1);
}

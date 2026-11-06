import { expect, type Page } from '@playwright/test';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
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

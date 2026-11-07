import type { MindMap, MindNode } from '../../src/contexts/map/domain/types';

export function createLargeMap(): MindMap {
  const root: MindNode = { id: 'large-map-root', text: '学习计划', children: [] };
  let level = [root];

  for (const [size, title] of [
    [3, '学习领域'],
    [9, '学习方向'],
    [27, '研究专题'],
    [100, '实践任务'],
    [360, '行动步骤'],
  ] as const) {
    const nextLevel: MindNode[] = [];
    const childrenPerParent = Math.floor(size / level.length);
    const extraChildren = size % level.length;
    for (const [index, parent] of level.entries()) {
      const count = childrenPerParent + (index < extraChildren ? 1 : 0);
      for (let childIndex = 0; childIndex < count; childIndex += 1) {
        const child: MindNode = {
          id: `${parent.id}-${String(childIndex + 1)}`,
          text: `${title} ${String(nextLevel.length + 1)}`,
          children: [],
        };
        parent.children.push(child);
        nextLevel.push(child);
      }
    }
    level = nextLevel;
  }

  return {
    id: 'large-map',
    title: '500 节点学习计划',
    roots: [root],
    createdAt: '2026-11-07T00:00:00.000Z',
    updatedAt: '2026-11-07T00:00:00.000Z',
  };
}

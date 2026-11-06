import type { NodeSize } from '../../contexts/map/application/layout/layout-forest';
import type { NodeId } from '../../contexts/map/domain/types';

// Measured node sizes fed back into layoutForest (design D4, "Fixture — issue #15").

export interface NodeMeasurement {
  id: NodeId;
  width: number;
  height: number;
}

// Merges one observer batch. When nothing changed it returns `current` itself, so the canvas
// state keeps its identity and no new layout runs; otherwise one new Map holding every current
// entry plus the changed or new ones (a later duplicate in the batch wins). Values are not
// filtered: layoutForest already falls back to the estimate for an invalid size.
export function mergeNodeSizes(
  current: ReadonlyMap<NodeId, NodeSize>,
  measurements: readonly NodeMeasurement[],
): ReadonlyMap<NodeId, NodeSize> {
  let next: Map<NodeId, NodeSize> | undefined;
  for (const { id, width, height } of measurements) {
    const stored = (next ?? current).get(id);
    if (stored?.width === width && stored.height === height) continue;
    next ??= new Map(current);
    next.set(id, { width, height });
  }
  return next ?? current;
}

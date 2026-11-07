import type { MapSummary } from './map-repository';

// List order of every MapRepository adapter (port doc comment): updatedAt descending (ISO-8601
// strings compared as strings), ties by id ascending in plain code-unit order (not localeCompare).

// Branch-free: -1, 0 or 1.
function order(left: string, right: string): number {
  return Number(left > right) - Number(left < right);
}

export function byRecency(left: MapSummary, right: MapSummary): number {
  return order(right.updatedAt, left.updatedAt) || order(left.id, right.id);
}

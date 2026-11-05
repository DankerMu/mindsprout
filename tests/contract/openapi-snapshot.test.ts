import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Public API contract (Pillar 4). An intentional schema change updates BOTH files in the same PR;
// CI never regenerates the snapshot.
describe('OpenAPI contract snapshot', () => {
  it('matches schemas/snapshots/openapi.yaml.snapshot byte for byte', () => {
    const current = readFileSync('schemas/openapi.yaml', 'utf8');
    const snapshot = readFileSync('schemas/snapshots/openapi.yaml.snapshot', 'utf8');

    expect(current).toBe(snapshot);
  });
});

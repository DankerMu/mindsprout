import { describe, expectTypeOf, it } from 'vitest';
import type { ColorToken, MindMap, MindNode, NewNode, NodeId, Position } from './types';

// types.ts is type-only; these assertions are checked by `pnpm typecheck` (tsc), not at runtime.
describe('map domain types', () => {
  it('NodeId is a string and Position is a plain x/y pair', () => {
    expectTypeOf<NodeId>().toEqualTypeOf<string>();
    expectTypeOf<Position>().toEqualTypeOf<{ x: number; y: number }>();
  });

  it('ColorToken is exactly the six semantic tokens', () => {
    expectTypeOf<ColorToken>().toEqualTypeOf<
      'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple'
    >();
  });

  it('MindNode carries optional note/color/collapsed/position and required children', () => {
    expectTypeOf<MindNode>().toEqualTypeOf<{
      id: NodeId;
      text: string;
      note?: string;
      color?: ColorToken;
      collapsed?: boolean;
      position?: Position;
      children: MindNode[];
    }>();
  });

  it('MindMap holds roots plus metadata and no owner', () => {
    expectTypeOf<MindMap>().toEqualTypeOf<{
      id: string;
      title: string;
      roots: MindNode[];
      createdAt: string;
      updatedAt: string;
    }>();
  });

  it('NewNode is recursive and never carries a position', () => {
    expectTypeOf<NewNode>().toEqualTypeOf<{
      id: NodeId;
      text: string;
      note?: string;
      color?: ColorToken;
      collapsed?: boolean;
      children?: NewNode[];
    }>();
    expectTypeOf<NewNode>().not.toHaveProperty('position');
  });
});

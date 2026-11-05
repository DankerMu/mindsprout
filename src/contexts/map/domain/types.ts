// Map domain shapes (design D1, D2, D9). Type-only: runtime validation lives in tree-op.ts.

// Caller-generated (nanoid) so ops stay replayable.
export type NodeId = string;

// Six semantic tokens; "no color" is the absence of a token, not a seventh value.
export type ColorToken = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';

export interface Position {
  x: number;
  y: number;
}

export interface MindNode {
  id: NodeId;
  text: string;
  note?: string;
  color?: ColorToken;
  collapsed?: boolean;
  // Floating roots (roots[1..]) only; the primary root and tree nodes never carry one.
  position?: Position;
  children: MindNode[];
}

export interface MindMap {
  id: string;
  title: string;
  // roots[0] is the primary root; roots[1..] are floating subtrees.
  roots: MindNode[];
  createdAt: string;
  updatedAt: string;
}

// Recursive creation payload: a whole subtree, never a position.
export interface NewNode {
  id: NodeId;
  text: string;
  note?: string;
  color?: ColorToken;
  collapsed?: boolean;
  children?: NewNode[];
}

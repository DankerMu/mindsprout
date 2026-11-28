import type { TreeOp } from './tree-op';
import type { NodeId } from './types';

// Op source port of the map context (design D9). Type-only: adapters live in infrastructure/.

export interface GenerateInput {
  topic: string;
  rootId: NodeId;
}

/**
 * Streams the TreeOps generated for a topic, each validated by `parseTreeOp`, in order.
 * The iterable ends in exactly one way:
 * - it returns normally after the generation completed;
 * - it returns normally because `signal` aborted (Stop or leave), whatever else happened;
 * - it throws one `GenerateError` whose code picks the notice.
 */
export interface GenerateSource {
  generate(input: GenerateInput, signal: AbortSignal): AsyncIterable<TreeOp>;
}

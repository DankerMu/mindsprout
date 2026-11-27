import type { NodeId, TreeOp } from '../acl/map';

// The ai context's single port (decision 0002, design D1). Type-only: adapters live in
// infrastructure/providers/.

export interface GenerateRequest {
  topic: string;
  // The map's primary root: the target of the model's `root` parent.
  rootId: NodeId;
  signal: AbortSignal;
}

// One attempt: validated add_children ops with server ids, in emission order.
export interface Provider {
  streamOps(request: GenerateRequest): AsyncIterable<TreeOp>;
}

import { z } from 'zod';

// The Generate protocol (design D2): the model sees one tool and calls it once per parent,
// naming each child with a temporary id; `root` names the primary root.
export const GENERATE_TOOL_NAME = 'add_children';

// Strict: an unknown field, an empty children list or empty text is invalid output, never repaired.
export const generateToolInputSchema = z.strictObject({
  parentId: z.string(),
  children: z
    .array(
      z.strictObject({
        id: z.string(),
        text: z.string().min(1),
      }),
    )
    .min(1),
});

// Truncation bounds per generation (TECH §5.3): levels below the primary root, children per
// parent counted across calls, and nodes in total. Tests inject smaller caps.
export interface GenerationCaps {
  depth: number;
  perParent: number;
  total: number;
}

// total 60 is unreachable under depth 2 × 7 per parent (56): defence in depth (design D2).
export const PRODUCTION_CAPS: Readonly<GenerationCaps> = { depth: 2, perParent: 7, total: 60 };

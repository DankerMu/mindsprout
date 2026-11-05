import { z } from 'zod';
import { TreeOpError } from './errors';
import type { ColorToken, NewNode, Position } from './types';

// TreeOp protocol v1 (design D2). Every object schema is strict: unknown keys are rejected, so a
// `position` on a creation payload fails here as invalid-op before the reducer sees the op.
// Optional keys use exactOptional so an explicit `undefined` is rejected (exactOptionalPropertyTypes).
// Range checks against the map (index > length, roots index 0) stay in the reducer as invalid-target.

const nodeIdSchema = z.string();

const indexSchema = z.int().min(0).exactOptional();

// z.number() rejects NaN and ±Infinity in zod 4, so a position is always finite.
const positionSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
}) satisfies z.ZodType<Position>;

const colorTokenSchema = z.enum([
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
]) satisfies z.ZodType<ColorToken>;

const newNodeSchema: z.ZodType<NewNode> = z.lazy(() =>
  z.strictObject({
    id: nodeIdSchema,
    text: z.string(),
    note: z.string().exactOptional(),
    color: colorTokenSchema.exactOptional(),
    collapsed: z.boolean().exactOptional(),
    children: z.array(newNodeSchema).exactOptional(),
  }),
);

export const addChildrenOp = z.strictObject({
  op: z.literal('add_children'),
  parentId: nodeIdSchema,
  children: z.array(newNodeSchema).min(1),
  index: indexSchema,
});

export const addRootOp = z.strictObject({
  op: z.literal('add_root'),
  node: newNodeSchema,
  position: positionSchema,
  index: indexSchema,
});

export const updateNodeOp = z
  .strictObject({
    op: z.literal('update_node'),
    id: nodeIdSchema,
    text: z.string().exactOptional(),
    // null clears the field; absent leaves it untouched.
    note: z.string().nullable().exactOptional(),
    color: colorTokenSchema.nullable().exactOptional(),
    collapsed: z.boolean().exactOptional(),
  })
  .refine(
    (op) =>
      op.text !== undefined ||
      op.note !== undefined ||
      op.color !== undefined ||
      op.collapsed !== undefined,
    { message: 'update_node needs at least one of text, note, color, collapsed' },
  );

export const deleteNodeOp = z.strictObject({
  op: z.literal('delete_node'),
  id: nodeIdSchema,
});

const reparentOp = z.strictObject({
  op: z.literal('move_node'),
  id: nodeIdSchema,
  newParentId: nodeIdSchema,
  index: indexSchema,
});

const detachOp = z.strictObject({
  op: z.literal('move_node'),
  id: nodeIdSchema,
  newParentId: z.null(),
  position: positionSchema,
  index: indexSchema,
});

// Discriminated on newParentId: null requires position, a node id forbids it (both strict).
// zod keys a discriminated union only on literal values, and a node id is any string, so the two
// shapes are a plain union. The loose `op` guard in front gives the outer union its `op` literal.
export const moveNodeOp = z
  .looseObject({ op: z.literal('move_node') })
  .pipe(z.union([reparentOp, detachOp]));

export const setRootPositionOp = z.strictObject({
  op: z.literal('set_root_position'),
  id: nodeIdSchema,
  position: positionSchema,
});

export const replaceChildrenOp = z.strictObject({
  op: z.literal('replace_children'),
  parentId: nodeIdSchema,
  children: z.array(newNodeSchema),
});

export const treeOpSchema = z.discriminatedUnion('op', [
  addChildrenOp,
  addRootOp,
  updateNodeOp,
  deleteNodeOp,
  moveNodeOp,
  setRootPositionOp,
  replaceChildrenOp,
]);

export type TreeOp = z.infer<typeof treeOpSchema>;

// Schema boundary: validates the payload alone, before (and without) any tree traversal.
export function parseTreeOp(input: unknown): TreeOp {
  const result = treeOpSchema.safeParse(input);
  if (!result.success) {
    const summary = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(op)'}: ${issue.message}`)
      .join('; ');
    throw new TreeOpError('invalid-op', `Invalid TreeOp — ${summary}`, result.error.issues);
  }
  return result.data;
}

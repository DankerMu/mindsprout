import { z } from 'zod';
import { TreeOpError } from './errors';
import type { ColorToken, MindMap, MindNode, Position } from './types';

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

const nodeFields = {
  id: z.string(),
  text: z.string(),
  note: z.string().exactOptional(),
  color: colorTokenSchema.exactOptional(),
  collapsed: z.boolean().exactOptional(),
  children: z.array(z.lazy(() => nodeSchema)),
};

const nodeSchema: z.ZodType<MindNode> = z.strictObject(nodeFields);
const floatingRootSchema = z.strictObject({
  ...nodeFields,
  position: positionSchema,
});

const mindMapSchema = z
  .strictObject({
    id: z.string(),
    title: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    roots: z.tuple([nodeSchema]).rest(floatingRootSchema),
  })
  .superRefine((map, context) => {
    const ids = new Set<string>();
    const path: (string | number)[] = ['roots'];
    function visit(nodes: MindNode[]): void {
      nodes.forEach((node, index) => {
        path.push(index);
        if (ids.has(node.id)) {
          context.addIssue({
            code: 'custom',
            path: [...path, 'id'],
            message: `Duplicate node id: ${node.id}`,
          });
        }
        ids.add(node.id);
        path.push('children');
        visit(node.children);
        path.pop();
        path.pop();
      });
    }
    visit(map.roots);
  });

export function parseMindMap(input: unknown): MindMap {
  const result = mindMapSchema.safeParse(input);
  if (!result.success) {
    const summary = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(map)'}: ${issue.message}`)
      .join('; ');
    throw new TreeOpError('invalid-op', `Invalid MindMap — ${summary}`, result.error.issues);
  }
  return result.data;
}

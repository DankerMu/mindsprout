import type { ColorToken, MindMap, NodeId, Position } from '../../domain/types';
import type { EditorState } from '../editor-store/editor-store';
import { findNode, parentOf, visibleIds } from '../editor-store/selection';

export interface MenuContext {
  readonly target: NodeId;
  readonly map: MindMap;
  readonly selection: readonly NodeId[];
  readonly positions: ReadonlyMap<NodeId, Position>;
  readonly actions: Pick<
    EditorState,
    'createNode' | 'startEdit' | 'select' | 'deleteSelection' | 'dispatch' | 'runGrouped'
  >;
}

interface MenuFields {
  readonly id: string;
  readonly label: string | ((ctx: MenuContext) => string);
  readonly shortcut?: string;
  isEnabled(ctx: MenuContext): boolean;
}

interface MenuAction extends MenuFields {
  run(ctx: MenuContext): void;
}

interface MenuSubmenu extends MenuFields {
  readonly children: readonly MenuAction[];
}

export type MenuItem = MenuAction | MenuSubmenu;

function resolveAction(item: MenuAction, ctx: MenuContext, parent?: MenuSubmenu) {
  return {
    ...item,
    label: typeof item.label === 'function' ? item.label(ctx) : item.label,
    run(context: MenuContext): void {
      if (
        visibleIds(context.map).includes(context.target) &&
        item.isEnabled(context) &&
        (parent === undefined || parent.isEnabled(context))
      )
        item.run(context);
    },
  };
}

export function createMenuRegistry() {
  const items: MenuItem[] = [];
  return {
    register(item: MenuItem): void {
      if (items.some((entry) => entry.id === item.id))
        throw new Error(`Duplicate menu item: ${item.id}`);
      items.push(item);
    },
    list(ctx: MenuContext) {
      return items.map((item) =>
        'children' in item
          ? {
              ...item,
              label: typeof item.label === 'function' ? item.label(ctx) : item.label,
              children: item.children.map((child) => resolveAction(child, ctx, item)),
            }
          : resolveAction(item, ctx),
      );
    },
  };
}

export const nodeMenu = createMenuRegistry();
nodeMenu.register({
  id: 'add-child',
  label: '添加子节点',
  shortcut: 'Tab',
  isEnabled: () => true,
  run: (ctx) => {
    ctx.actions.createNode(ctx.target);
  },
});
nodeMenu.register({
  id: 'add-sibling',
  label: '添加兄弟节点',
  shortcut: 'Enter',
  isEnabled: (ctx) => parentOf(ctx.map.roots, ctx.target) !== undefined,
  run: (ctx) => {
    const parent = parentOf(ctx.map.roots, ctx.target);
    if (parent !== undefined) {
      ctx.actions.createNode(
        parent.id,
        parent.children.findIndex((child) => child.id === ctx.target) + 1,
      );
    }
  },
});
nodeMenu.register({
  id: 'rename',
  label: '重命名',
  shortcut: 'F2',
  isEnabled: () => true,
  run: (ctx) => {
    ctx.actions.startEdit(ctx.target);
  },
});
nodeMenu.register({
  id: 'delete',
  label: '删除',
  shortcut: 'Delete',
  isEnabled: (ctx) => ctx.map.roots[0]?.id !== ctx.target,
  run: (ctx) => {
    if (!ctx.selection.includes(ctx.target)) ctx.actions.select(ctx.target);
    ctx.actions.deleteSelection();
  },
});
nodeMenu.register({
  id: 'collapse',
  label: (ctx) => (findNode(ctx.map, ctx.target)?.collapsed === true ? '展开' : '折叠'),
  isEnabled: () => true,
  run: (ctx) => {
    ctx.actions.dispatch({
      op: 'update_node',
      id: ctx.target,
      collapsed: findNode(ctx.map, ctx.target)?.collapsed !== true,
    });
  },
});
nodeMenu.register({
  id: 'color',
  label: '设置颜色',
  isEnabled: () => true,
  children: (['red', 'orange', 'yellow', 'green', 'blue', 'purple', null] as const).map(
    (color: ColorToken | null) => ({
      id: color ?? 'clear',
      label: color ?? '无颜色',
      isEnabled: () => true,
      run: (ctx: MenuContext) => {
        const ids = ctx.selection.includes(ctx.target) ? ctx.selection : [ctx.target];
        ctx.actions.runGrouped('color', () => {
          for (const id of ids) ctx.actions.dispatch({ op: 'update_node', id, color });
        });
      },
    }),
  ),
});
nodeMenu.register({
  id: 'detach',
  label: '脱离为浮动节点',
  isEnabled: (ctx) => parentOf(ctx.map.roots, ctx.target) !== undefined,
  run: (ctx) => {
    const position = ctx.positions.get(ctx.target);
    if (position !== undefined) {
      ctx.actions.dispatch({ op: 'move_node', id: ctx.target, newParentId: null, position });
    }
  },
});

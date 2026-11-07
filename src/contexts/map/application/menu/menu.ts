import type { MindMap, NodeId, Position } from '../../domain/types';
import type { EditorState } from '../editor-store/editor-store';
import { findNode, parentOf, visibleIds } from '../editor-store/selection';

export interface MenuContext {
  readonly target: NodeId;
  readonly map: MindMap;
  readonly selection: readonly NodeId[];
  readonly positions: ReadonlyMap<NodeId, Position>;
  readonly actions: Pick<
    EditorState,
    'createNode' | 'startEdit' | 'select' | 'deleteSelection' | 'dispatch'
  >;
}

export interface MenuItem {
  readonly id: string;
  readonly label: string | ((ctx: MenuContext) => string);
  readonly shortcut?: string;
  isEnabled(ctx: MenuContext): boolean;
  run(ctx: MenuContext): void;
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
      return items.map((item) => ({
        ...item,
        label: typeof item.label === 'function' ? item.label(ctx) : item.label,
        run(context: MenuContext): void {
          if (visibleIds(context.map).includes(context.target) && item.isEnabled(context))
            item.run(context);
        },
      }));
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

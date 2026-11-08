'use client';

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { EditorState } from '../../contexts/map/application/editor-store/editor-store';
import { visibleIds } from '../../contexts/map/application/editor-store/selection';
import { nodeMenu, type MenuContext } from '../../contexts/map/application/menu/menu';
import type { MindMap, NodeId, Position } from '../../contexts/map/domain/types';
import { isCompositionKey } from './selection-input';

export interface CanvasMenu {
  getState(): EditorState;
  readonly requestNoteFocus: (target: NodeId) => void;
}
interface MenuSession {
  target: NodeId;
  map: MindMap;
  positions: ReadonlyMap<NodeId, Position>;
  point: Position;
  canvas: HTMLElement;
}

function menuContext(
  session: MenuSession,
  map: MindMap,
  positions: ReadonlyMap<NodeId, Position>,
  controls: CanvasMenu | undefined,
): MenuContext | undefined {
  if (controls === undefined) return;
  const state = controls.getState();
  if (map !== session.map || positions !== session.positions) return;
  if (state.map !== session.map || state.editing !== null || state.menuTargetId !== session.target)
    return;
  if (!visibleIds(state.map).includes(session.target)) return;
  return {
    target: session.target,
    map: state.map,
    selection: state.selectedIds,
    positions,
    actions: state,
    requestNoteFocus: controls.requestNoteFocus,
  };
}

export function useContextMenu(
  map: MindMap,
  positions: ReadonlyMap<NodeId, Position>,
  controls: CanvasMenu | undefined,
) {
  const [session, setSession] = useState<MenuSession | null>(null);
  const owner = useRef<MenuSession | null>(null);
  const live = useRef({ map, positions, controls });
  useLayoutEffect(() => {
    live.current = { map, positions, controls };
  }, [map, positions, controls]);

  function close(expected: MenuSession, focus = false) {
    if (owner.current !== expected) return;
    owner.current = null;
    const state = live.current.controls?.getState();
    if (state?.menuTargetId === expected.target) state.closeMenu();
    setSession(null);
    if (focus) expected.canvas.focus();
  }
  function context(expected: MenuSession): MenuContext | undefined {
    if (owner.current !== expected) return;
    const current = live.current;
    return menuContext(expected, current.map, current.positions, current.controls);
  }
  useEffect(() => {
    if (session !== null && context(session) === undefined) close(session);
  });
  useEffect(
    () => () => {
      const expected = owner.current;
      owner.current = null;
      const state = live.current.controls?.getState();
      if (expected !== null && state?.menuTargetId === expected.target) state.closeMenu();
    },
    [],
  );

  return {
    open(event: MouseEvent, target: NodeId) {
      const state = controls?.getState();
      if (state?.map !== map || state.editing !== null || !positions.has(target)) return;
      const canvas = event.currentTarget.closest<HTMLElement>('[role="region"]');
      if (canvas === null) return;
      event.preventDefault();
      state.openMenu(target);
      const next = {
        target,
        map,
        positions,
        point: { x: event.clientX, y: event.clientY },
        canvas,
      };
      owner.current = next;
      setSession(next);
    },
    menu:
      session === null ? null : (
        <ContextMenu
          key={`${session.target}:${session.point.x.toString()}:${session.point.y.toString()}`}
          session={session}
          current={menuContext(session, map, positions, controls)}
          context={() => context(session)}
          close={(focus) => {
            close(session, focus);
          }}
        />
      ),
  };
}

function menuKeyBlocked(event: KeyboardEvent): boolean {
  return (
    isCompositionKey(event) ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  );
}

function activatesMenuItem(key: string, button: HTMLButtonElement | undefined): boolean {
  return (
    key === 'Enter' ||
    key === ' ' ||
    (key === 'ArrowRight' && button?.getAttribute('aria-haspopup') === 'menu')
  );
}

function navigateMenu(menu: HTMLElement, key: string): void {
  const buttons = Array.from(
    menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
  ).filter((button) => button.closest('[role="menu"]') === menu);
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next = index;
  if (key === 'ArrowDown') next = (index + 1) % buttons.length;
  if (key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
  if (key === 'Home') next = 0;
  if (key === 'End') next = buttons.length - 1;
  if (activatesMenuItem(key, buttons[index])) buttons[index]?.click();
  else buttons[next]?.focus();
}

function ContextMenu({
  session,
  current,
  context,
  close,
}: {
  session: MenuSession;
  current: MenuContext | undefined;
  context: () => MenuContext | undefined;
  close: (focus?: boolean) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<string | null>(null);
  const entries = current === undefined ? [] : nodeMenu.list(current);
  useLayoutEffect(() => {
    const menu = element.current;
    if (menu === null) return;
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(session.point.x, window.innerWidth - box.width)).toString()}px`;
    menu.style.top = `${Math.max(0, Math.min(session.point.y, window.innerHeight - box.height)).toString()}px`;
  }, [session, submenu]);
  useLayoutEffect(() => {
    element.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [session]);
  useLayoutEffect(() => {
    if (submenu === null) return;
    element.current
      ?.querySelector<HTMLElement>('[role="menu"]')
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus();
  }, [submenu]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [close]);
  function activate(entry: (typeof entries)[number]) {
    const ctx = context();
    if (ctx === undefined || !entry.isEnabled(ctx)) return;
    if ('children' in entry) {
      setSubmenu(entry.id);
      return;
    }
    close(true);
    entry.run(ctx);
  }
  if (current === undefined) return null;
  return createPortal(
    <div
      ref={element}
      role="menu"
      aria-label="节点菜单"
      style={{
        position: 'fixed',
        zIndex: 2000,
        display: 'grid',
        boxSizing: 'border-box',
        padding: 4,
        background: 'Canvas',
        color: 'CanvasText',
        border: '1px solid GrayText',
        borderRadius: 6,
        maxWidth: '100vw',
        maxHeight: '100vh',
        overflow: 'auto',
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      onKeyUp={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if (menuKeyBlocked(event.nativeEvent)) return;
        const activeMenu =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>('[role="menu"]')
            : null;
        if (activeMenu === null) return;
        if (
          activeMenu !== event.currentTarget &&
          (event.key === 'Escape' || event.key === 'ArrowLeft')
        ) {
          const trigger = event.currentTarget.querySelector<HTMLButtonElement>(
            '[aria-haspopup="menu"][aria-expanded="true"]',
          );
          setSubmenu(null);
          trigger?.focus();
        } else if (event.key === 'Escape' || event.key === 'Tab') {
          close(true);
        } else {
          navigateMenu(activeMenu, event.key);
        }
      }}
    >
      {entries.map((entry) => (
        <div key={entry.id} role="none" style={{ display: 'grid' }}>
          <button
            type="button"
            role="menuitem"
            disabled={!entry.isEnabled(current)}
            aria-haspopup={'children' in entry ? 'menu' : undefined}
            aria-expanded={'children' in entry ? submenu === entry.id : undefined}
            onClick={() => {
              activate(entry);
            }}
            style={{ textAlign: 'left', padding: '6px 12px' }}
          >
            {entry.label}
            {entry.shortcut !== undefined && (
              <span aria-hidden="true" style={{ float: 'right', marginLeft: 24 }}>
                {entry.shortcut}
              </span>
            )}
          </button>
          {'children' in entry && submenu === entry.id && (
            <div role="menu" aria-label={entry.label} style={{ display: 'grid', paddingLeft: 12 }}>
              {entry.children.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  role="menuitem"
                  disabled={!entry.isEnabled(current) || !child.isEnabled(current)}
                  onClick={() => {
                    activate(child);
                  }}
                  style={{ textAlign: 'left', padding: '6px 12px' }}
                >
                  {child.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

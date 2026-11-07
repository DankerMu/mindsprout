import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  borderBoxEntry,
  canvasObserverOf,
  mindNodeElement,
  nodeWrapper,
  renderedPosition,
  viewportTransform,
} from '../../../tests/support/canvas';
import {
  MAP,
  measure,
  move,
  observers,
  setup,
  start,
  stop,
  touchAt,
  touchPreview,
} from '../../../tests/support/canvas-drag';
import { node } from '../../../tests/support/map-domain';
import { MindMapCanvas } from './MindMapCanvas';

describe('native drag input ownership', () => {
  it.each([
    { restart: false, group: false },
    { restart: true, group: false },
    { restart: false, group: true },
    { restart: true, group: true },
  ])(
    'stops viewport autopan after edge abort (restart=$restart, group=$group)',
    async ({ restart, group }) => {
      const frames = new Map<number, FrameRequestCallback>();
      let frameId = 0;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.set(++frameId, callback);
        return frameId;
      });
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
        frames.delete(id);
      });
      const advanceFrame = async () => {
        await act(async () => {
          const pending = [...frames.values()];
          frames.clear();
          for (const callback of pending) callback(performance.now());
          await Promise.resolve();
        });
      };
      const { store, unmount } = setup();
      if (group)
        act(() => {
          store.getState().setSelection(['a', 'f']);
        });
      const before = store.getState().map;
      const target = nodeWrapper('a');
      const origin = renderedPosition('a');
      const initial = touchAt(target, 1, origin.x + 20, origin.y + 10);
      fireEvent.touchStart(target, { touches: [initial], changedTouches: [initial] });
      const edge = { identifier: 1, target, clientX: 995, clientY: 500 };
      fireEvent.touchMove(target, { touches: [edge], changedTouches: [edge] });
      const beforeFrame = viewportTransform();
      await advanceFrame();
      const during = viewportTransform();
      expect(during.x).toBeLessThan(beforeFrame.x);
      expect(renderedPosition('a')).not.toStrictEqual(origin);
      if (group) expect(renderedPosition('f')).not.toStrictEqual({ x: 500, y: 200 });
      const second = { identifier: 2, target: document.body, clientX: 700, clientY: 500 };
      fireEvent.touchStart(document.body, { touches: [edge, second], changedTouches: [second] });
      fireEvent.touchMove(target, { touches: [edge, second], changedTouches: [edge] });
      fireEvent.touchEnd(target, { touches: [second], changedTouches: [edge] });
      fireEvent.touchEnd(document.body, { touches: [], changedTouches: [second] });
      expect(renderedPosition('a')).toStrictEqual(origin);
      expect(renderedPosition('f')).toStrictEqual({ x: 500, y: 200 });
      expect(store.getState().map).toBe(before);
      expect(store.getState().canUndo).toBe(false);
      const released = viewportTransform();
      if (restart) {
        const next = nodeWrapper('p');
        const nextOrigin = renderedPosition('p');
        const nextTouch = touchAt(next, 7, nextOrigin.x + 20, nextOrigin.y + 10);
        fireEvent.touchStart(next, { touches: [nextTouch], changedTouches: [nextTouch] });
        const nextCentre = touchAt(next, 7, 420, 310);
        fireEvent.touchMove(next, { touches: [nextCentre], changedTouches: [nextCentre] });
        expect(renderedPosition('p')).toStrictEqual({ x: 400, y: 300 });
      }
      await advanceFrame();
      await advanceFrame();
      const afterFrames = viewportTransform();
      expect(afterFrames).toStrictEqual(released);
      if (restart) {
        const next = nodeWrapper('p');
        const nextEdge = { identifier: 7, target: next, clientX: 995, clientY: 500 };
        fireEvent.touchMove(next, { touches: [nextEdge], changedTouches: [nextEdge] });
        const beforePan = viewportTransform();
        await advanceFrame();
        const afterPan = viewportTransform();
        expect(afterPan.x - beforePan.x).toBe(during.x - beforeFrame.x);
        const centre = touchAt(next, 7, 420, 310);
        fireEvent.touchMove(next, { touches: [centre], changedTouches: [centre] });
        fireEvent.touchEnd(next, { touches: [], changedTouches: [centre] });
        expect(store.getState().map?.roots.at(-1)?.id).toBe('p');
        fireEvent.keyDown(screen.getByRole('region'), { key: 'z', ctrlKey: true });
        expect(store.getState().map).toStrictEqual(MAP);
        expect(store.getState().canUndo).toBe(false);
      }
      unmount();
      await advanceFrame();
    },
  );

  it('refuses a moving mouse gesture when composition begins before release', () => {
    const { store } = setup();
    const before = store.getState().map;
    const origin = start('a');
    move(420, 310);
    expect(renderedPosition('a')).toStrictEqual({ x: 400, y: 300 });
    fireEvent.compositionStart(screen.getByRole('region'));
    stop(420, 310);
    expect(renderedPosition('a')).toStrictEqual(origin);
    expect(store.getState().map).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });

  it.each(['pane', 'outside', 'source'] as const)(
    'discards a touch preview when a second finger starts on the %s and recovers',
    async (location) => {
      const { store, repository } = setup();
      const before = store.getState().map;
      const { target, origin, moved } = touchPreview('a');
      const pane = document.querySelector('.react-flow__pane');
      if (pane === null) throw new Error('no pane');
      const secondTarget =
        location === 'pane' ? pane : location === 'outside' ? document.body : target;
      const second = touchAt(secondTarget, 2, 700, 500);
      const stopBubbling = (event: Event) => {
        event.stopPropagation();
      };
      secondTarget.addEventListener('touchstart', stopBubbling);
      fireEvent.touchStart(secondTarget, { touches: [moved, second], changedTouches: [second] });
      secondTarget.removeEventListener('touchstart', stopBubbling);
      expect(renderedPosition('a')).toStrictEqual(origin);
      fireEvent.touchMove(target, { touches: [moved, second], changedTouches: [moved] });
      fireEvent.touchEnd(target, { touches: [second], changedTouches: [moved] });
      fireEvent.touchEnd(secondTarget, { touches: [], changedTouches: [second] });
      expect(renderedPosition('a')).toStrictEqual(origin);
      expect(store.getState().map).toBe(before);
      expect(store.getState().canUndo).toBe(false);
      await act(() => store.getState().flush());
      expect(repository.puts).toStrictEqual([]);
      const independent = touchPreview('a', 7);
      fireEvent.touchEnd(independent.target, { touches: [], changedTouches: [independent.moved] });
      expect(store.getState().map?.roots.at(-1)).toStrictEqual(
        node('a', [node('d')], { position: { x: 400, y: 300 } }),
      );
      fireEvent.keyDown(screen.getByRole('region'), { key: 'z', ctrlKey: true });
      expect(store.getState().map).toStrictEqual(MAP);
      expect(store.getState().canUndo).toBe(false);
    },
  );

  it.each(['a', 'p'])(
    'cancels overlapping mouse and touch ownership on %s rather than committing the wrong stop',
    async (touchedId) => {
      const { store, repository } = setup();
      const before = store.getState().map;
      const originA = start('a');
      const originP = renderedPosition('p');
      move(420, 310);
      expect(renderedPosition('a')).toStrictEqual({ x: 400, y: 300 });
      const target = nodeWrapper(touchedId);
      const position = renderedPosition(touchedId);
      const touch = touchAt(target, 3, position.x + 20, position.y + 10);
      fireEvent.touchStart(target, { touches: [touch], changedTouches: [touch] });
      const moved = touchAt(target, 3, 620, 410);
      fireEvent.touchMove(target, { touches: [moved], changedTouches: [moved] });
      stop(420, 310);
      fireEvent.touchEnd(target, { touches: [], changedTouches: [moved] });
      expect(store.getState().map).toBe(before);
      expect(renderedPosition('a')).toStrictEqual(originA);
      expect(renderedPosition('p')).toStrictEqual(originP);
      expect(store.getState().canUndo).toBe(false);
      await act(() => store.getState().flush());
      expect(repository.puts).toStrictEqual([]);
    },
  );

  it.each(['a', 'p'])('cancels a touch owner when mouse input overlaps on %s', (id) => {
    const { store } = setup();
    const before = store.getState().map;
    const { target, origin, moved } = touchPreview('a');
    start(id);
    move(620, 410);
    fireEvent.touchEnd(target, { touches: [], changedTouches: [moved] });
    stop(620, 410);
    expect(store.getState().map).toBe(before);
    expect(renderedPosition('a')).toStrictEqual(origin);
    expect(store.getState().canUndo).toBe(false);
  });

  it('discards native touch cancellation and accepts a fresh touch identifier', () => {
    const { store } = setup();
    const before = store.getState().map;
    const { target, origin, moved } = touchPreview('a', 9);
    fireEvent.touchCancel(target, { touches: [], changedTouches: [moved] });
    expect(renderedPosition('a')).toStrictEqual(origin);
    expect(store.getState().map).toBe(before);
    const next = touchPreview('a', 23);
    fireEvent.touchEnd(next.target, { touches: [], changedTouches: [next.moved] });
    expect(store.getState().map?.roots.at(-1)?.position).toStrictEqual({ x: 400, y: 300 });
    fireEvent.keyDown(screen.getByRole('region'), { key: 'z', ctrlKey: true });
    expect(store.getState().map).toStrictEqual(MAP);
    expect(store.getState().canUndo).toBe(false);
  });

  it.each(['mouse-first', 'touch-first'])(
    'keeps a collision latched until both inputs release (%s)',
    (order) => {
      const { store } = setup();
      const before = store.getState().map;
      const origin = start('a');
      move(420, 310);
      const target = nodeWrapper('p');
      const position = renderedPosition('p');
      const touch = touchAt(target, 3, position.x + 20, position.y + 10);
      fireEvent.touchStart(target, { touches: [touch], changedTouches: [touch] });
      if (order === 'mouse-first') {
        stop(420, 310);
        start('a');
        move(620, 410);
        stop(620, 410);
        expect(store.getState().map).toBe(before);
        expect(renderedPosition('a')).toStrictEqual(origin);
        fireEvent.touchEnd(target, { touches: [], changedTouches: [touch] });
      } else {
        fireEvent.touchEnd(target, { touches: [], changedTouches: [touch] });
        const second = touchAt(target, 4, position.x + 20, position.y + 10);
        fireEvent.touchStart(target, { touches: [second], changedTouches: [second] });
        const moved = touchAt(target, 4, 620, 410);
        fireEvent.touchMove(target, { touches: [moved], changedTouches: [moved] });
        fireEvent.touchEnd(target, { touches: [], changedTouches: [moved] });
        expect(store.getState().map).toBe(before);
        expect(renderedPosition('a')).toStrictEqual(origin);
        stop(420, 310);
      }
      expect(store.getState().canUndo).toBe(false);
      const independent = touchPreview('a', 7);
      fireEvent.touchEnd(independent.target, { touches: [], changedTouches: [independent.moved] });
      expect(store.getState().map?.roots.at(-1)?.position).toStrictEqual({ x: 400, y: 300 });
      fireEvent.keyDown(screen.getByRole('region'), { key: 'z', ctrlKey: true });
      expect(store.getState().map).toStrictEqual(MAP);
      expect(store.getState().canUndo).toBe(false);
    },
  );

  it('keeps an unmounted collision unchanged while a fresh canvas accepts an independent drag', () => {
    const previous = setup();
    const before = previous.store.getState().map;
    const first = touchPreview('a');
    const second = touchAt(document.body, 2, 700, 500);
    fireEvent.touchStart(document.body, {
      touches: [first.moved, second],
      changedTouches: [second],
    });
    previous.unmount();
    fireEvent.touchEnd(document.body, { touches: [], changedTouches: [first.moved, second] });
    expect(previous.store.getState().map).toBe(before);
    expect(previous.store.getState().canUndo).toBe(false);
    expect(previous.repository.puts).toStrictEqual([]);
    const { store } = setup();
    expect(store.getState().canUndo).toBe(false);
    const independent = touchPreview('a', 7);
    fireEvent.touchEnd(independent.target, { touches: [], changedTouches: [independent.moved] });
    expect(store.getState().map?.roots.at(-1)?.position).toStrictEqual({ x: 400, y: 300 });
    fireEvent.keyDown(screen.getByRole('region'), { key: 'z', ctrlKey: true });
    expect(store.getState().map).toStrictEqual(MAP);
    expect(store.getState().canUndo).toBe(false);
    expect(previous.store.getState().map).toBe(before);
    expect(previous.store.getState().canUndo).toBe(false);
    expect(previous.repository.puts).toStrictEqual([]);
  });
});

describe('controlled node drag through the editor', () => {
  it('previews the grabbed subtree, selects it, then detaches with one undo step', () => {
    const { store } = setup();
    act(() => {
      store.getState().select('p');
    });
    const before = store.getState().map;
    const other = renderedPosition('p');
    start('a');
    move(420, 310);
    expect(renderedPosition('a')).toStrictEqual({ x: 400, y: 300 });
    expect(renderedPosition('p')).toStrictEqual(other);
    expect(store.getState().selectedIds).toStrictEqual(['a']);
    expect(store.getState().map).toBe(before);
    expect(store.getState().canUndo).toBe(false);
    stop(420, 310);
    expect(store.getState().map?.roots.at(-1)).toStrictEqual(
      node('a', [node('d')], { position: { x: 400, y: 300 } }),
    );
    fireEvent.keyDown(screen.getByRole('region'), { key: 'z', ctrlKey: true });
    expect(store.getState().map).toStrictEqual(MAP);
    expect(store.getState().canUndo).toBe(false);
  });

  it.each([
    ['a', 'd'],
    ['r', 'f'],
    ['a', 'a'],
  ])('visibly moves %s then refuses %s without history or persistence', async (id, target) => {
    const { store, repository } = setup();
    const before = store.getState().map;
    const destination = renderedPosition(target);
    const origin = start(id);
    move(420, 310);
    expect(renderedPosition(id)).not.toStrictEqual(origin);
    move(destination.x + 10, destination.y + 10);
    stop(destination.x + 10, destination.y + 10);
    expect(renderedPosition(id)).toStrictEqual(origin);
    expect(store.getState().map).toBe(before);
    expect(store.getState().canUndo).toBe(false);
    await act(() => store.getState().flush());
    expect(repository.puts).toStrictEqual([]);
  });

  it.each(['undo', 'delete', 'layout', 'escape', 'pointercancel', 'blur'] as const)(
    'cancels a moving preview on %s without reverting newer state',
    (reason) => {
      const { store } = setup();
      act(() => {
        store.getState().dispatch({ op: 'update_node', id: 'p', text: 'Changed' });
      });
      const origin = start('a');
      move(420, 310);
      expect(renderedPosition('a')).not.toStrictEqual(origin);
      if (reason === 'undo')
        act(() => {
          store.getState().undo();
        });
      if (reason === 'delete')
        act(() => {
          store.getState().dispatch({ op: 'delete_node', id: 'a' });
        });
      if (reason === 'layout')
        canvasObserverOf(observers()).fire([borderBoxEntry(mindNodeElement('r'), 100, 32)]);
      if (reason === 'escape') fireEvent.keyDown(screen.getByRole('region'), { key: 'Escape' });
      if (reason === 'pointercancel') fireEvent.pointerCancel(window);
      if (reason === 'blur') fireEvent.blur(window);
      const current = store.getState().map;
      stop(420, 310);
      expect(store.getState().map).toBe(current);
      if (reason !== 'delete') expect(renderedPosition('a')).not.toStrictEqual({ x: 400, y: 300 });
    },
  );

  it('keeps a cancelled preview discarded after committing an unchanged title', () => {
    const { store } = setup();
    act(() => {
      store.getState().dispatch({ op: 'update_node', id: 'p', text: 'Changed' });
    });
    const before = store.getState().map;
    const origin = start('a');
    move(420, 310);
    expect(renderedPosition('a')).toStrictEqual({ x: 400, y: 300 });
    fireEvent.keyDown(screen.getByRole('region'), { key: 'F2' });
    expect(store.getState().editing?.id).toBe('a');
    expect(renderedPosition('a')).toStrictEqual(origin);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '节点标题' }), { key: 'Enter' });
    expect(store.getState().editing).toBeNull();
    expect(store.getState().map).toBe(before);
    expect(renderedPosition('a')).toStrictEqual(origin);
    stop(420, 310);
    expect(store.getState().map).toBe(before);
    expect(renderedPosition('a')).toStrictEqual(origin);
    expect(store.getState().canUndo).toBe(true);
    fireEvent.keyDown(screen.getByRole('region'), { key: 'z', ctrlKey: true });
    expect(store.getState().map).toStrictEqual(MAP);
    expect(store.getState().canUndo).toBe(false);
  });

  it.each(['editing', 'composition', 'space', 'middle', 'text'] as const)(
    'keeps %s gestures inert while an ordinary drag remains enabled',
    (gate) => {
      const { store } = setup();
      start('a');
      move(420, 310);
      stop(420, 310);
      expect(store.getState().canUndo).toBe(true);
      act(() => {
        store.getState().undo();
      });
      if (gate === 'editing')
        act(() => {
          store.getState().startEdit('p');
        });
      if (gate === 'composition') fireEvent.compositionStart(screen.getByRole('region'));
      if (gate === 'space') fireEvent.keyDown(window, { key: ' ', code: 'Space' });
      if (gate === 'text') {
        const input = document.createElement('input');
        document.body.append(input);
        input.focus();
      }
      const before = store.getState().map;
      const origin = start('a', gate === 'middle' ? 1 : 0);
      move(420, 310);
      stop(420, 310);
      expect(renderedPosition('a')).toStrictEqual(origin);
      expect(store.getState().map).toBe(before);
      expect(store.getState().canUndo).toBe(false);
      if (gate === 'space') fireEvent.keyUp(window, { key: ' ', code: 'Space' });
      if (gate === 'text') document.querySelector('body > input')?.remove();
    },
  );

  it('uses the released touch pointer while retaining the grabbed top-left', () => {
    const { store } = setup();
    const origin = renderedPosition('a');
    const viewport = viewportTransform();
    const touch = (x: number, y: number) => ({
      identifier: 1,
      target: nodeWrapper('a'),
      clientX: x + viewport.x,
      clientY: y + viewport.y,
    });
    const initial = touch(origin.x + 20, origin.y + 10);
    fireEvent.touchStart(nodeWrapper('a'), { touches: [initial], changedTouches: [initial] });
    const end = touch(420, 310);
    fireEvent.touchMove(nodeWrapper('a'), { touches: [end], changedTouches: [end] });
    expect(renderedPosition('a')).toStrictEqual({ x: 400, y: 300 });
    fireEvent.touchEnd(nodeWrapper('a'), { touches: [], changedTouches: [end] });
    expect(store.getState().map?.roots.at(-1)).toStrictEqual(
      node('a', [node('d')], { position: { x: 400, y: 300 } }),
    );
  });

  it('leaves static consumers inert and cancels an unmounted active gesture', () => {
    const staticView = render(<MindMapCanvas map={MAP} />);
    measure();
    const origin = start('a');
    move(420, 310);
    stop(420, 310);
    expect(renderedPosition('a')).toStrictEqual(origin);
    staticView.unmount();
    const { store, unmount } = setup();
    start('a');
    move(420, 310);
    expect(renderedPosition('a')).not.toStrictEqual(origin);
    const before = store.getState().map;
    const release = new MouseEvent('mouseup', { clientX: 520, clientY: 410 });
    Object.defineProperty(release, 'view', { value: window });
    unmount();
    fireEvent(window, release);
    expect(store.getState().map).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });
});

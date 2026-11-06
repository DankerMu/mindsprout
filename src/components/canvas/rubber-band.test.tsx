import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStore } from 'zustand';
import { failOnConsoleNoise, nodeWrapper, renderedPosition } from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import { createEditorStore } from '../../contexts/map/application/editor-store/editor-store';
import { MindMapCanvas } from './MindMapCanvas';

failOnConsoleNoise();

const MAP = mapOf(
  node('r', [node('a'), node('b'), node('c')]),
  node('f', [], { position: { x: 900, y: 900 } }),
);

function setup() {
  const repository = new RecordingRepository();
  const store = createEditorStore({ repository });
  store.getState().load(MAP);
  function Canvas() {
    const state = useStore(store);
    return <MindMapCanvas map={MAP} selection={state} />;
  }
  render(<Canvas />);
  const region = screen.getByRole('region', { name: '思维导图画布' });
  Object.assign(region, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
  const pane = region.querySelector('.react-flow__pane');
  if (pane === null) throw new Error('missing pane');
  return { store, region, pane, repository };
}

function pointerDown(target: Element, options: PointerEventInit = {}) {
  fireEvent.pointerDown(target, { pointerType: 'mouse', isPrimary: true, ...options });
}

describe('canvas rubber band', () => {
  it('selects exactly fully enclosed visible nodes and replaces the prior selection', () => {
    const { store, region, pane } = setup();
    fireEvent.click(nodeWrapper('f'));
    const a = renderedPosition('a');
    const c = renderedPosition('c');
    pointerDown(pane, { button: 0, pointerId: 1, clientX: a.x - 5, clientY: a.y - 5 });
    fireEvent.pointerMove(region, { pointerId: 1, clientX: c.x + 100, clientY: c.y + 40 });
    fireEvent.pointerUp(region, { pointerId: 1, clientX: c.x + 100, clientY: c.y + 40 });
    expect(store.getState().selectedIds).toEqual(['a', 'b', 'c']);
    expect(store.getState().map).toBe(MAP);
    expect(store.getState().canUndo).toBe(false);
  });

  it('excludes partial nodes in either drag direction and clears for an empty rectangle', () => {
    const { store, region, pane } = setup();
    const a = renderedPosition('a');
    const b = renderedPosition('b');
    const drag = (x: number, y: number, endX: number, endY: number) => {
      pointerDown(pane, { button: 0, pointerId: 1, clientX: x, clientY: y });
      fireEvent.pointerMove(region, { pointerId: 1, clientX: endX, clientY: endY });
      fireEvent.pointerUp(region, { pointerId: 1, clientX: endX, clientY: endY });
    };
    drag(a.x + 100, b.y + 10, a.x - 5, a.y - 5);
    expect(store.getState().selectedIds).toEqual(['a']);
    drag(700, 700, 750, 750);
    expect(store.getState().selectedIds).toEqual([]);
  });

  it('cancels capture and ignores no-drag, non-pane, middle and Space gestures', () => {
    const { store, region, pane } = setup();
    fireEvent.click(nodeWrapper('a'));
    const before = store.getState();
    fireEvent.pointerMove(region, { clientX: 500, clientY: 500 });
    fireEvent.pointerUp(region, { clientX: 500, clientY: 500 });
    pointerDown(pane, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(region, { pointerId: 1, clientX: 0, clientY: 0 });
    pointerDown(pane, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerCancel(region, { pointerId: 1 });
    fireEvent.pointerUp(region, { pointerId: 1, clientX: 500, clientY: 500 });
    pointerDown(nodeWrapper('a'), { button: 0 });
    pointerDown(pane, { button: 1 });
    fireEvent.keyDown(region, { key: ' ', code: 'Space' });
    pointerDown(pane, { button: 0 });
    fireEvent.click(nodeWrapper('b'));
    fireEvent.keyUp(region, { key: ' ', code: 'Space' });
    expect(store.getState()).toBe(before);
  });

  it.each(['window', 'region'])(
    'keeps %s Space out of band and click selection, then resets on window blur',
    (target) => {
      const { store, region, pane } = setup();
      fireEvent.click(nodeWrapper('a'));
      if (target === 'window') {
        act(() => {
          region.blur();
        });
        expect(document.activeElement).toBe(document.body);
      }
      fireEvent.keyDown(target === 'window' ? window : region, { key: ' ', code: 'Space' });
      pointerDown(pane, { button: 0, pointerId: 1, clientX: 700, clientY: 700 });
      fireEvent.pointerMove(region, { pointerId: 1, clientX: 800, clientY: 750 });
      expect.soft(region.querySelector(':scope > [aria-hidden="true"]')).toBeNull();
      fireEvent.pointerUp(region, { pointerId: 1, clientX: 800, clientY: 750 });
      expect.soft(store.getState().selectedIds).toEqual(['a']);
      fireEvent.click(nodeWrapper('b'));
      expect.soft(store.getState().selectedIds).toEqual(['a']);
      fireEvent.blur(window);
      fireEvent.click(nodeWrapper('b'));
      expect(store.getState().selectedIds).toEqual(['b']);
    },
  );

  it.each([
    { pointerType: 'touch', isPrimary: true, button: 0 },
    { pointerType: 'mouse', isPrimary: false, button: 0 },
    { pointerType: 'mouse', isPrimary: true, button: 2 },
  ])(
    'does not select for a $pointerType pointer with primary=$isPrimary button=$button',
    (pointer) => {
      const { store, region, pane } = setup();
      const setPointerCapture = vi.spyOn(region, 'setPointerCapture');
      fireEvent.click(nodeWrapper('a'));
      pointerDown(pane, { ...pointer, pointerId: 1, clientX: 700, clientY: 700 });
      fireEvent.pointerMove(region, { pointerId: 1, clientX: 800, clientY: 750 });
      fireEvent.pointerUp(region, { pointerId: 1, clientX: 800, clientY: 750 });
      expect(store.getState().selectedIds).toEqual(['a']);
      expect(region.querySelector(':scope > [aria-hidden="true"]')).toBeNull();
      expect(setPointerCapture).not.toHaveBeenCalled();
    },
  );

  it('ignores another pointer while the originating mouse owns the band', () => {
    const { store, region, pane } = setup();
    fireEvent.click(nodeWrapper('f'));
    const a = renderedPosition('a');
    const c = renderedPosition('c');
    pointerDown(pane, { pointerId: 1, clientX: a.x - 5, clientY: a.y - 5 });
    fireEvent.pointerMove(region, { pointerId: 1, clientX: c.x + 100, clientY: c.y + 40 });
    const rectangle = region.querySelector(':scope > [aria-hidden="true"]')?.getAttribute('style');
    pointerDown(pane, { pointerType: 'touch', pointerId: 2, clientX: 700, clientY: 700 });
    fireEvent.pointerMove(region, { pointerId: 2, clientX: 800, clientY: 750 });
    expect(region.querySelector(':scope > [aria-hidden="true"]')?.getAttribute('style')).toBe(
      rectangle,
    );
    fireEvent.pointerUp(region, { pointerId: 2, clientX: 800, clientY: 750 });
    fireEvent.pointerCancel(region, { pointerId: 2 });
    fireEvent.lostPointerCapture(region, { pointerId: 2 });
    expect(store.getState().selectedIds).toEqual(['f']);
    fireEvent.pointerUp(region, { pointerId: 1, clientX: c.x + 100, clientY: c.y + 40 });
    expect(store.getState().selectedIds).toEqual(['a', 'b', 'c']);
  });

  it('ignores pointer selection and canvas keys during composition, text focus or editing', () => {
    const { store, region, pane } = setup();
    fireEvent.click(nodeWrapper('a'));
    const before = store.getState();
    fireEvent.compositionStart(region);
    fireEvent.keyDown(region, { key: 'a', ctrlKey: true });
    fireEvent.click(nodeWrapper('b'));
    pointerDown(pane, { button: 0 });
    expect(store.getState()).toBe(before);
    fireEvent.compositionEnd(region);
    fireEvent.keyDown(region, { key: 'a', ctrlKey: true, isComposing: true });
    expect(store.getState()).toBe(before);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const space = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(input, space);
    expect(space.defaultPrevented).toBe(false);
    fireEvent.click(nodeWrapper('b'));
    pointerDown(pane, { button: 0 });
    expect(store.getState()).toBe(before);
    input.remove();
    fireEvent.click(nodeWrapper('b'));
    expect(store.getState().selectedIds).toEqual(['b']);
    act(() => {
      store.getState().startEdit('a');
    });
    const editing = store.getState();
    fireEvent.click(nodeWrapper('b'));
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(store.getState()).toBe(editing);
  });

  it('drops a band if editing starts before release and lost capture cancels it', () => {
    const { store, region, pane } = setup();
    pointerDown(pane, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    act(() => {
      store.getState().startEdit('a');
    });
    fireEvent.pointerUp(region, { pointerId: 1, clientX: 500, clientY: 500 });
    expect(store.getState().selectedIds).toEqual([]);
    act(() => {
      store.getState().cancelEdit();
    });
    pointerDown(pane, { button: 0, pointerId: 1 });
    fireEvent.lostPointerCapture(region, { pointerId: 1 });
    fireEvent.pointerUp(region, { pointerId: 1, clientX: 500, clientY: 500 });
    expect(store.getState().selectedIds).toEqual([]);
  });

  it('reflects external store actions, preserves click order and never persists selection', async () => {
    const { store, region, repository } = setup();
    act(() => {
      store.getState().setSelection(['a', 'b', 'c']);
    });
    expect(region.querySelectorAll('[aria-pressed="true"]')).toHaveLength(3);
    fireEvent.click(nodeWrapper('b'));
    expect(store.getState().selectedIds).toEqual(['b']);
    fireEvent.click(nodeWrapper('b'));
    expect(store.getState().selectedIds).toEqual(['b']);
    fireEvent.click(nodeWrapper('a'), { shiftKey: true });
    fireEvent.click(nodeWrapper('c'), { shiftKey: true });
    expect(store.getState().selectedIds).toEqual(['b', 'a', 'c']);
    expect(store.getState().primaryId).toBe('c');
    fireEvent.click(nodeWrapper('a'), { shiftKey: true });
    expect(store.getState().selectedIds).toEqual(['b', 'c']);
    expect(store.getState().primaryId).toBe('c');
    fireEvent.click(nodeWrapper('c'), { shiftKey: true });
    expect(store.getState().selectedIds).toEqual(['b']);
    expect(store.getState().primaryId).toBe('b');
    fireEvent.keyDown(region, { key: 'ArrowUp' });
    expect(store.getState().selectedIds).toEqual(['a']);
    const position = renderedPosition('a');
    fireEvent.keyDown(nodeWrapper('a'), { key: 'ArrowRight' });
    expect(renderedPosition('a')).toEqual(position);
    fireEvent.keyDown(nodeWrapper('a'), { key: 'Delete' });
    fireEvent.keyDown(nodeWrapper('a'), { key: 'Backspace' });
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(store.getState().selectedIds).toEqual(['a']);
    fireEvent.keyUp(region, { key: 'ArrowUp' });
    fireEvent.blur(region);
    await store.getState().flush();
    expect(repository.puts).toEqual([]);
    expect(store.getState().map).toBe(MAP);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(false);
  });
});

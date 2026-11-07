import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import {
  borderBoxEntry,
  canvasObserverOf,
  failOnConsoleNoise,
  installControllableResizeObservers,
  mindNodeElement,
  nodeWrapper,
  reactFlowNodeObserverOf,
  renderedPosition,
  sizedWrapperEntry,
  viewportTransform,
} from './canvas';
import { mapOf, node } from './map-domain';
import { RecordingRepository } from './map-repository-stub';
import type { EditorState } from '../../src/contexts/map/application/editor-store/editor-store';
import { EditorSession, useEditorStoreApi } from '../../src/components/editor/EditorSession';
import { EditorView } from '../../src/components/editor/EditorView';

failOnConsoleNoise();
export const observers = installControllableResizeObservers();
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('react-flow')
      ? new DOMRect(0, 0, 1000, 1000)
      : Element.prototype.getBoundingClientRect.call(this);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(1000);
});
export const MAP = mapOf(
  node('r', [node('a', [node('d')]), node('p')]),
  node('f', [], { position: { x: 500, y: 200 } }),
);

export function setup() {
  let store!: StoreApi<EditorState>;
  function Probe() {
    store = useEditorStoreApi();
    return null;
  }
  const repository = new RecordingRepository();
  const view = render(
    <EditorSession map={MAP} repository={repository}>
      <Probe />
      <EditorView />
    </EditorSession>,
  );
  measure();
  return { store, repository, ...view };
}

export function measure() {
  const ids = ['r', 'a', 'd', 'p', 'f'];
  const active = observers().filter((observer) => observer.observed.size > 0);
  canvasObserverOf(active).fire(ids.map((id) => borderBoxEntry(mindNodeElement(id), 80, 32)));
  reactFlowNodeObserverOf(active).fire(ids.map((id) => sizedWrapperEntry(id, 80, 32)));
  const pane = document.querySelector('.react-flow__pane');
  if (pane === null) throw new Error('no pane');
  mouse(pane, 'mousedown', 100, 100, 1);
  mouse(window, 'mousemove', 200, 200, 1);
  mouse(window, 'mouseup', 200, 200, 1);
}

function mouse(
  target: Element | Window,
  type: string,
  clientX: number,
  clientY: number,
  button = 0,
) {
  const viewport = viewportTransform();
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button,
    buttons: button === 1 ? 4 : 1,
    clientX: clientX + viewport.x,
    clientY: clientY + viewport.y,
  });
  Object.defineProperty(event, 'view', { value: window });
  fireEvent(target, event);
}
export function start(id: string, button = 0) {
  const position = renderedPosition(id);
  mouse(nodeWrapper(id), 'mousedown', position.x + 20, position.y + 10, button);
  return position;
}
export function move(x: number, y: number) {
  mouse(window, 'mousemove', x, y);
}
export function stop(x: number, y: number) {
  mouse(window, 'mouseup', x, y);
}
export function touchAt(target: Element, identifier: number, x: number, y: number) {
  const viewport = viewportTransform();
  return { identifier, target, clientX: x + viewport.x, clientY: y + viewport.y };
}
export function touchPreview(id: string, identifier = 1) {
  const target = nodeWrapper(id);
  const origin = renderedPosition(id);
  const initial = touchAt(target, identifier, origin.x + 20, origin.y + 10);
  fireEvent.touchStart(target, { touches: [initial], changedTouches: [initial] });
  const moved = touchAt(target, identifier, 420, 310);
  fireEvent.touchMove(target, { touches: [moved], changedTouches: [moved] });
  expect(renderedPosition(id)).toStrictEqual({ x: 400, y: 300 });
  return { target, origin, moved };
}

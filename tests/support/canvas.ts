import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi, type MockInstance } from 'vitest';

// Shared jsdom support for the canvas component tests (design "Fixture — issue #15"). React Flow
// internals are never mocked: these helpers stand in for browser services jsdom lacks
// (ResizeObserver callbacks, element geometry) and read what React Flow rendered.

// Fails the test on any console.error or console.warn, checked after an explicit unmount so
// unmount-time noise is caught too. React Flow's own devWarn is silent outside development.
export function failOnConsoleNoise(): void {
  let error: MockInstance<typeof console.error>;
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    error = vi.spyOn(console, 'error');
    warn = vi.spyOn(console, 'warn');
  });
  afterEach(() => {
    cleanup();
    expect(error.mock.calls).toStrictEqual([]);
    expect(warn.mock.calls).toStrictEqual([]);
    error.mockRestore();
    warn.mockRestore();
  });
}

// A ResizeObserver whose callback the test fires. Like a browser's, it delivers entries only
// for targets it currently observes, and it can observe again after disconnect().
export class ControllableResizeObserver {
  readonly observed = new Set<Element>();
  readonly everObserved = new Set<Element>();
  readonly unobserved: Element[] = [];
  disconnectCalls = 0;

  constructor(readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
    this.everObserved.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
    this.unobserved.push(target);
  }

  disconnect(): void {
    this.observed.clear();
    this.disconnectCalls += 1;
  }

  // Delivers one batch, inside act because the callback updates React state.
  fire(entries: readonly Partial<ResizeObserverEntry>[]): void {
    const delivered = entries.filter(
      ({ target }) => target !== undefined && this.observed.has(target),
    );
    this.deliver(delivered);
  }

  // Delivers the entries whether or not their targets are observed (a late, stale batch).
  deliver(entries: readonly Partial<ResizeObserverEntry>[]): void {
    act(() => {
      this.callback(entries as ResizeObserverEntry[], this);
    });
  }
}

const resizeObservers: ControllableResizeObserver[] = [];

// Installs ControllableResizeObserver for each test of the calling suite and restores the
// global afterwards; returns the instances created during the current test.
export function installControllableResizeObservers(): () => readonly ControllableResizeObserver[] {
  beforeEach(() => {
    resizeObservers.length = 0;
    vi.stubGlobal('ResizeObserver', ControllableResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  return () => resizeObservers;
}

// The canvas observer: the one instance that ever observed a `.mind-node` element. React Flow's
// own observers watch its node wrappers and pane, never `.mind-node`.
export function canvasObserverOf(
  instances: readonly ControllableResizeObserver[],
): ControllableResizeObserver {
  const measuring = instances.filter((instance) =>
    [...instance.everObserved].some((target) => target.classList.contains('mind-node')),
  );
  expect(measuring).toHaveLength(1);
  const [only] = measuring;
  if (only === undefined) throw new Error('no observer measured a .mind-node element');
  return only;
}

export function borderBoxEntry(
  target: Element,
  width: number,
  height: number,
): Partial<ResizeObserverEntry> {
  return { target, borderBoxSize: [{ inlineSize: width, blockSize: height }] };
}

function nodeWrapper(id: string): HTMLElement {
  const wrapper = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
  if (wrapper === null) throw new Error(`node ${id} is not rendered`);
  return wrapper;
}

export function mindNodeElement(id: string): HTMLElement {
  const element = nodeWrapper(id).querySelector<HTMLElement>('.mind-node');
  if (element === null) throw new Error(`node ${id} has no .mind-node element`);
  return element;
}

const NUMBER = String.raw`(-?[\d.]+(?:e[-+]?\d+)?)`;
const TRANSLATE = new RegExp(String.raw`translate\(\s*${NUMBER}px\s*,\s*${NUMBER}px\s*\)`);
const SCALE = new RegExp(String.raw`scale\(\s*${NUMBER}\s*\)`);

function numbersOf(pattern: RegExp, transform: string): number[] {
  const match = pattern.exec(transform);
  if (match === null) throw new Error(`no ${pattern.source} in "${transform}"`);
  return match.slice(1).map(Number);
}

// React Flow writes `translate(${x}px,${y}px)`; parsed as numbers, never compared verbatim.
export function renderedPosition(id: string): { x: number; y: number } {
  const [x = Number.NaN, y = Number.NaN] = numbersOf(TRANSLATE, nodeWrapper(id).style.transform);
  return { x, y };
}

export function viewportTransform(): { x: number; y: number; zoom: number } {
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (viewport === null) throw new Error('no .react-flow__viewport');
  const { transform } = viewport.style;
  const [x = Number.NaN, y = Number.NaN] = numbersOf(TRANSLATE, transform);
  const [zoom = Number.NaN] = numbersOf(SCALE, transform);
  return { x, y, zoom };
}

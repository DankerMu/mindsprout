import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Setup file of the `dom` Vitest project only (design "Fixture — issue #14"); node tests never
// load it. jsdom lacks these browser APIs and React Flow touches them on mount, so each is
// installed as an inert stand-in, never a behavioural mock, and only when absent so a real
// implementation always wins. A test that needs real geometry adds its own per-test setup.

const noop = (): undefined => undefined;

// Absent means the value is undefined, not that the key is missing: Vitest's jsdom environment
// pre-defines proxy accessors on the global (which is the window) for keys jsdom does not
// implement, e.g. `matchMedia`, and those accessors return undefined.
function installIfAbsent(name: string, value: unknown): void {
  if (Reflect.get(globalThis, name) === undefined) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
}

// observe/unobserve/disconnect do nothing; the callback is never invoked.
class InertResizeObserver implements ResizeObserver {
  observe = noop;
  unobserve = noop;
  disconnect = noop;
}

function inertMatchMedia(query: string) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: noop,
    removeListener: noop,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => false,
  };
}

// The identity matrix whatever the constructor argument. React Flow reads
// `new DOMMatrixReadOnly(transform).m22` as the zoom, so identity means zoom 1.
class IdentityMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  m11 = 1;
  m12 = 0;
  m13 = 0;
  m14 = 0;
  m21 = 0;
  m22 = 1;
  m23 = 0;
  m24 = 0;
  m31 = 0;
  m32 = 0;
  m33 = 1;
  m34 = 0;
  m41 = 0;
  m42 = 0;
  m43 = 0;
  m44 = 1;
  is2D = true;
  isIdentity = true;
}

installIfAbsent('ResizeObserver', InertResizeObserver);
installIfAbsent('matchMedia', inertMatchMedia);
installIfAbsent('DOMMatrixReadOnly', IdentityMatrix);
installIfAbsent('DOMMatrix', IdentityMatrix);

// Vitest globals are off, so Testing Library's auto-cleanup never registers; unmount explicitly.
afterEach(cleanup);

declare global {
  // Read by React: when true, a state update outside act(...) logs a "not wrapped in act" error.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Testing Library's auto-setup would set this, but it is skipped with Vitest globals off. Without
// it, React stays silent about updates outside act (observer callbacks, timers, store writes).
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

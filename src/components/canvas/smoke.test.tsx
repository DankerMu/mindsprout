import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

// Smoke test for the component-test tier (design "Fixture — issue #14"): a `.test.tsx` file runs
// in the `dom` Vitest project (jsdom + tests/support/dom-shims.ts). The counter is defined inline
// on purpose — the tier ships no production component (proposal "Fixture triage — issue #14").

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button
      type="button"
      onClick={() => {
        setCount((current) => current + 1);
      }}
    >
      {count}
    </button>
  );
}

describe('component-test tier', () => {
  it('runs under a DOM environment with document and window', () => {
    expect(typeof document).toBe('object');
    expect(typeof window).toBe('object');
  });

  it('dispatches React DOM events and re-renders state', () => {
    render(<Counter />);

    fireEvent.click(screen.getByRole('button', { name: '0' }));

    expect(screen.getByRole('button').textContent).toBe('1');
  });

  it('marks the run as a React act environment', () => {
    expect(globalThis.IS_REACT_ACT_ENVIRONMENT).toBe(true);
  });

  it('installs a ResizeObserver that never invokes its callback', () => {
    const callback = vi.fn<ResizeObserverCallback>();
    const observer = new ResizeObserver(callback);

    observer.observe(document.body);
    observer.unobserve(document.body);
    observer.disconnect();

    expect(callback.mock.calls).toHaveLength(0);
  });

  it('installs a matchMedia that matches nothing and echoes the query', () => {
    const query = '(prefers-color-scheme: dark)';

    const result = window.matchMedia(query);

    expect(result.matches).toBe(false);
    expect(result.media).toBe(query);
  });

  it('installs identity DOMMatrixReadOnly and DOMMatrix that ignore their argument', () => {
    const readOnly = new DOMMatrixReadOnly('scale(2)');
    const mutable = new DOMMatrix();

    expect(readOnly.m22).toBe(1);
    expect(mutable.isIdentity).toBe(true);
  });

  describe('cleanup between tests', () => {
    const text = 'rendered once per test';

    it('renders the text in the first test', () => {
      render(<p>{text}</p>);

      expect(screen.getAllByText(text)).toHaveLength(1);
    });

    it('finds exactly one match in the second test because the first was unmounted', () => {
      render(<p>{text}</p>);

      expect(screen.getAllByText(text)).toHaveLength(1);
    });
  });
});

import 'fake-indexeddb/auto';
import { act, render, screen } from '@testing-library/react';
import { StrictMode, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { failOnConsoleNoise } from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import { StorageUnavailableError } from '../../contexts/map/domain/errors';
import type { MapRepository } from '../../contexts/map/domain/map-repository';
import { InMemoryMapRepository } from '../../contexts/map/infrastructure/persistence/in-memory-map-repository';
import {
  MapRepositoryProvider,
  openSessionRepository,
  useMapRepository,
  type RepositoryState,
} from './MapRepositoryProvider';

// Design "Fixture — issue #16": the session repository context, through Testing Library with an
// injected open; openSessionRepository itself runs against fake-indexeddb (jsdom has no indexedDB).

failOnConsoleNoise();

interface Deferred {
  promise: Promise<MapRepository>;
  resolve(repository: MapRepository): void;
  reject(error: Error): void;
}

function deferred(): Deferred {
  let resolve: Deferred['resolve'] = () => undefined;
  let reject: Deferred['reject'] = () => undefined;
  const promise = new Promise<MapRepository>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

// Renders the provider (with the injected open, or its default) and a probe that records every
// state it is handed.
function renderProvider(
  open?: () => Promise<MapRepository>,
  wrap: (element: ReactElement) => ReactElement = (element) => element,
): RepositoryState[] {
  const seen: RepositoryState[] = [];
  function Probe() {
    const state = useMapRepository();
    seen.push(state);
    return <p data-testid="repository-state">{state.status}</p>;
  }
  const provider =
    open === undefined ? (
      <MapRepositoryProvider>
        <Probe />
      </MapRepositoryProvider>
    ) : (
      <MapRepositoryProvider open={open}>
        <Probe />
      </MapRepositoryProvider>
    );
  render(wrap(provider));
  return seen;
}

function shownState(): string | null {
  return screen.getByTestId('repository-state').textContent;
}

// The repository of the last state seen, compared by identity: two empty InMemoryMapRepository
// instances are deeply equal.
function lastRepository(seen: readonly RepositoryState[]): MapRepository | undefined {
  const last = seen.at(-1);
  return last?.status === 'ready' ? last.repository : undefined;
}

describe('MapRepositoryProvider', () => {
  it('is opening until the injected open resolves, then ready with that repository', async () => {
    const opening = deferred();
    const repository = new InMemoryMapRepository();
    const seen = renderProvider(() => opening.promise);

    expect(shownState()).toBe('opening');

    await act(async () => {
      opening.resolve(repository);
      await opening.promise;
    });

    expect(shownState()).toBe('ready');
    expect(lastRepository(seen)).toBe(repository);
  });

  it.each([
    ['StorageUnavailableError', new StorageUnavailableError('IndexedDB could not be opened')],
    ['a plain Error', new Error('boom')],
  ])('is failed when the open rejects with %s', async (_label, error) => {
    const opening = deferred();
    const seen = renderProvider(() => opening.promise);

    await act(async () => {
      opening.reject(error);
      await opening.promise.catch(() => undefined);
    });

    expect(shownState()).toBe('failed');
    expect(seen.at(-1)).toStrictEqual({ status: 'failed' });
  });

  it.each([
    [
      'resolves with another repository',
      (late: Deferred) => {
        late.resolve(new InMemoryMapRepository());
      },
    ],
    [
      'rejects',
      (late: Deferred) => {
        late.reject(new Error('late failure of the discarded effect'));
      },
    ],
  ])('ignores a discarded StrictMode effect whose open %s late', async (_label, settleLate) => {
    const opens = [deferred(), deferred()];
    const live = new InMemoryMapRepository();
    let calls = 0;
    const seen = renderProvider(
      () => {
        const next = opens[calls];
        calls += 1;
        if (next === undefined) throw new Error('open was called more than twice');
        return next.promise;
      },
      (element) => <StrictMode>{element}</StrictMode>,
    );
    // StrictMode runs the open effect, cleans it up and runs it again: the first open is stale.
    expect(calls).toBe(2);
    const [stale, current] = opens as [Deferred, Deferred];

    await act(async () => {
      current.resolve(live);
      await current.promise;
    });
    await act(async () => {
      settleLate(stale);
      await stale.promise.catch(() => undefined);
    });

    expect(shownState()).toBe('ready');
    expect(lastRepository(seen)).toBe(live);
  });

  it('opens the session repository by default', async () => {
    const seen = renderProvider();

    expect(shownState()).toBe('opening');
    // The provider subscribed to the same promise first, so its update lands inside this act.
    const session = await act(() => openSessionRepository());

    expect(shownState()).toBe('ready');
    expect(lastRepository(seen)).toBe(session);
  });

  it('throws when useMapRepository is used outside the provider', () => {
    function Orphan() {
      useMapRepository();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow('useMapRepository must be used inside');
  });
});

describe('openSessionRepository', () => {
  it('returns one promise per session, resolving to a working repository', async () => {
    const first = openSessionRepository();
    const second = openSessionRepository();
    const map = { ...mapOf(node('r', [node('a')])), id: 'session-map', title: '会话' };

    expect(second).toBe(first);
    const repository = await first;
    await repository.put(map);
    expect(await repository.get('session-map')).toStrictEqual(map);
  });
});

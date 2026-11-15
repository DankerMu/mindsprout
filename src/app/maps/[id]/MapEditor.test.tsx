import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { failOnConsoleNoise } from '../../../../tests/support/canvas';
import { mapOf, node } from '../../../../tests/support/map-domain';
import { MapFetch } from '../../../../tests/support/map-fetch';
import { heldResult } from '../../../../tests/support/map-library';
import { RecordingRepository } from '../../../../tests/support/map-repository-stub';
import {
  StorageUnavailableError,
  UnsupportedSchemaVersionError,
} from '../../../contexts/map/domain/errors';
import type { MapRepository } from '../../../contexts/map/domain/map-repository';
import type { MindMap } from '../../../contexts/map/domain/types';
import { HttpMapRepository } from '../../../contexts/map/infrastructure/persistence/http-map-repository';
import { InMemoryMapRepository } from '../../../contexts/map/infrastructure/persistence/in-memory-map-repository';
import { MapRepositoryProvider } from '../../providers/MapRepositoryProvider';
import { MapEditor } from './MapEditor';

// Design "Fixture — issue #16": MapEditor inside the provider with an injected open, over an
// InMemoryMapRepository or a stub whose get outcomes the test scripts. Every get outcome must end
// in exactly one visible state; a rejection is never presented as not-found.

failOnConsoleNoise();
afterEach(() => {
  vi.unstubAllGlobals();
});

const NOT_FOUND = '找不到这张导图';
const FUTURE_VERSION = '此导图由更新版本创建';
const UNREADABLE = '无法打开这张导图';
const LOADING = '正在打开…';

// The title and the primary root text differ, so a header showing the root text fails.
const SEEDED: MindMap = { ...mapOf(node('r', [node('a')], { text: '根节点B' })), title: '标题A' };

interface HeldGet {
  resolve(map: MindMap | undefined): void;
  reject(error: Error): void;
}

// RecordingRepository (put recorded, readers fail loudly) whose get settles as the test scripts:
// each call takes the next held outcome, in call order.
class ScriptedGetRepository extends RecordingRepository {
  readonly held: HeldGet[] = [];

  override get(): Promise<MindMap | undefined> {
    return new Promise((resolve, reject) => {
      this.held.push({ resolve, reject });
    });
  }

  call(index: number): HeldGet {
    const held = this.held[index];
    if (held === undefined) throw new Error(`get call ${String(index)} was never made`);
    return held;
  }
}

function editorOver(
  open: () => Promise<MapRepository>,
  id: string,
  wrap: (element: ReactElement) => ReactElement = (element) => element,
) {
  return render(
    wrap(
      <MapRepositoryProvider open={open}>
        <MapEditor id={id} />
      </MapRepositoryProvider>,
    ),
  );
}

// Lets the open and get promises settle and React commit what they set.
async function settled(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function rejectGetWith(error: Error): Promise<ScriptedGetRepository> {
  const repository = new ScriptedGetRepository();
  editorOver(() => Promise.resolve(repository), 'm1');
  await settled();
  await act(async () => {
    repository.call(0).reject(error);
    await Promise.resolve();
  });
  return repository;
}

describe('MapEditor', () => {
  it('shows the loading state while the repository opens', () => {
    editorOver(() => new Promise<MapRepository>(() => undefined), 'm1');

    expect(screen.getByText(LOADING)).toBeTruthy();
  });

  it('shows the loading state while get is pending', async () => {
    const repository = new ScriptedGetRepository();
    editorOver(() => Promise.resolve(repository), 'm1');
    await settled();

    expect(repository.held).toHaveLength(1);
    expect(screen.getByText(LOADING)).toBeTruthy();
  });

  it('opens a stored map: the title in the header, the root text on the canvas', async () => {
    const repository = new InMemoryMapRepository();
    await repository.put(SEEDED);
    editorOver(() => Promise.resolve(repository), SEEDED.id);

    expect(await screen.findByTestId('map-editor-ready')).toBeTruthy();
    expect(screen.getByTestId('editor-title').textContent).toBe('标题A');
    expect((await screen.findByTestId('rf__node-r')).textContent).toBe('根节点B');
    expect(screen.queryByText(LOADING)).toBeNull();
  });

  it('shows not-found with a link back for an unknown id', async () => {
    editorOver(() => Promise.resolve(new InMemoryMapRepository()), 'does-not-exist');

    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    expect(screen.getByRole('link', { name: '返回导图列表' }).getAttribute('href')).toBe('/');
  });

  it('rejects a mismatched map identity without writes through pagehide and unmount', async () => {
    const repository = new ScriptedGetRepository();
    const { unmount } = editorOver(() => Promise.resolve(repository), SEEDED.id);
    await settled();
    await act(async () => {
      repository.call(0).resolve({ ...SEEDED, id: 'other-map' });
      await Promise.resolve();
    });

    expect(screen.getByText(UNREADABLE)).toBeTruthy();
    expect(screen.queryByTestId('map-editor-ready')).toBeNull();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText('未保存到浏览器')).toBeNull();
    expect(screen.getByRole('link', { name: '返回导图列表' }).getAttribute('href')).toBe('/');
    expect(repository.puts).toStrictEqual([]);

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await settled();
    expect(repository.puts).toStrictEqual([]);

    unmount();
    await settled();
    expect(repository.puts).toStrictEqual([]);
  });

  it('shows the future-version state and writes nothing', async () => {
    const repository = await rejectGetWith(new UnsupportedSchemaVersionError(2, 1));

    expect(screen.getByText(FUTURE_VERSION)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(repository.puts).toStrictEqual([]);
    expect(screen.queryByText('未保存到浏览器')).toBeNull();
  });

  it.each([
    ['a plain Error', new Error('stored map "m1" is unreadable')],
    ['StorageUnavailableError', new StorageUnavailableError('IndexedDB became unusable')],
  ])('shows the error state, never not-found, when get rejects with %s', async (_label, error) => {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname: '/maps/m1', assign });
    const repository = await rejectGetWith(error);

    expect(screen.getByText(UNREADABLE)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByTestId('map-editor-ready')).toBeNull();
    expect(repository.puts).toStrictEqual([]);
    expect(screen.queryByText('未保存到浏览器') !== null).toBe(
      error instanceof StorageUnavailableError,
    );
    expect(screen.getByRole('link', { name: '返回导图列表' }).getAttribute('href')).toBe('/');
    expect(assign).not.toHaveBeenCalled();
  });

  it('shows the error state when the repository failed to open', async () => {
    editorOver(() => Promise.reject(new Error('unexpected open failure')), 'm1');
    await settled();

    expect(screen.getByText(UNREADABLE)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText('未保存到浏览器')).toBeNull();
  });

  it('shows not-found and the persistent banner for an unknown fallback id', async () => {
    editorOver(() => Promise.reject(new StorageUnavailableError('blocked')), 'not-in-session');
    await settled();
    expect(screen.getByText(NOT_FOUND)).toBeTruthy();
    expect(screen.getAllByText('未保存到浏览器')).toHaveLength(1);
    expect(screen.queryByText(UNREADABLE)).toBeNull();
    expect(screen.getByRole('link', { name: '返回导图列表' }).getAttribute('href')).toBe('/');
  });

  it.each([
    [
      'rejects with an Error',
      (late: HeldGet) => {
        late.reject(new Error('late failure'));
      },
    ],
    [
      'resolves undefined',
      (late: HeldGet) => {
        late.resolve(undefined);
      },
    ],
    [
      'resolves a mismatched map identity',
      (late: HeldGet) => {
        late.resolve({ ...SEEDED, id: 'discarded-other-map' });
      },
    ],
    [
      'rejects with unavailable storage',
      (late: HeldGet) => {
        late.reject(new StorageUnavailableError('discarded unavailable read'));
      },
    ],
  ])('ignores the discarded StrictMode effect whose get %s late', async (_label, settleLate) => {
    const repository = new ScriptedGetRepository();
    editorOver(
      () => Promise.resolve(repository),
      SEEDED.id,
      (element) => <StrictMode>{element}</StrictMode>,
    );
    await settled();
    // StrictMode runs the load effect, cleans it up and runs it again: two gets, the first stale.
    expect(repository.held).toHaveLength(2);

    await act(async () => {
      repository.call(1).resolve(SEEDED);
      await Promise.resolve();
    });
    expect(screen.getByTestId('map-editor-ready')).toBeTruthy();

    await act(async () => {
      settleLate(repository.call(0));
      await Promise.resolve();
    });

    expect(screen.getByTestId('map-editor-ready')).toBeTruthy();
    expect(screen.getByTestId('editor-title').textContent).toBe('标题A');
    expect(screen.queryByText(UNREADABLE)).toBeNull();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText('未保存到浏览器')).toBeNull();
  });
});

describe('editor load session expiry', () => {
  it.each([
    { id: 'm1', pathname: '/maps/m1', next: '/login?next=%2Fmaps%2Fm1' },
    { id: 'map two', pathname: '/maps/map%20two', next: '/login?next=%2Fmaps%2Fmap%2520two' },
  ])('redirects the current HTTP 401 at $pathname to login', async ({ id, pathname, next }) => {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname, search: '?view=map', assign });
    const server = new MapFetch();
    server.respondNext(() => new Response(null, { status: 401 }));
    editorOver(() => Promise.resolve(new HttpMapRepository(server.fetch)), id);
    await waitFor(() => {
      expect(assign.mock.calls).toEqual([[next]]);
    });
    expect(server.requests).toHaveLength(1);
    expect(screen.queryByTestId('map-editor-ready')).toBeNull();
    expect(screen.queryByText(UNREADABLE)).toBeNull();
  });

  it.each([
    { status: 500, message: UNREADABLE },
    { status: 404, message: NOT_FOUND },
    { status: 409, message: FUTURE_VERSION },
    { status: null, message: UNREADABLE },
  ])('preserves the HTTP $status load outcome', async ({ status, message }) => {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname: '/maps/m1', assign });
    const server = new MapFetch();
    server.respondNext(() => {
      if (status === null) throw new TypeError('network disconnected');
      return Response.json({ error: 'unsupported-schema-version', found: 2 }, { status });
    });
    editorOver(() => Promise.resolve(new HttpMapRepository(server.fetch)), 'm1');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('ignores an expired prior-map load after a different map opens', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname: '/maps/current', assign });
    const server = new MapFetch();
    const stale = heldResult<Response>();
    server.respondNext(() => stale.promise);
    const repository = new HttpMapRepository(server.fetch);
    const open = () => Promise.resolve(repository);
    const view = editorOver(open, 'previous');
    await settled();
    expect(server.requests).toHaveLength(1);
    server.respondNext(() =>
      Response.json({ schemaVersion: 1, map: { ...SEEDED, id: 'current', title: '当前导图' } }),
    );
    view.rerender(
      <MapRepositoryProvider open={open}>
        <MapEditor id="current" />
      </MapRepositoryProvider>,
    );
    expect(await screen.findByTestId('map-editor-ready')).toBeTruthy();
    await act(async () => {
      stale.resolve(new Response(null, { status: 401 }));
      await stale.promise;
    });
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor-title').textContent).toBe('当前导图');
    expect(server.requests).toMatchObject([
      { input: '/api/maps/previous', init: { method: 'GET' } },
      { input: '/api/maps/current', init: { method: 'GET' } },
    ]);
  });

  it('ignores HTTP 401 from a StrictMode-discarded editor load', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname: '/maps/m1', assign });
    const server = new MapFetch();
    const discarded = heldResult<Response>();
    server.respondNext(() => discarded.promise);
    server.respondNext(() => Response.json({ schemaVersion: 1, map: SEEDED }));
    editorOver(
      () => Promise.resolve(new HttpMapRepository(server.fetch)),
      'm1',
      (element) => <StrictMode>{element}</StrictMode>,
    );
    expect(await screen.findByTestId('map-editor-ready')).toBeTruthy();
    expect(server.requests).toHaveLength(2);
    await act(async () => {
      discarded.resolve(new Response(null, { status: 401 }));
      await discarded.promise;
    });
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor-title').textContent).toBe('标题A');
  });
});

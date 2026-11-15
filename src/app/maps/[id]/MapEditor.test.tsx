import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  type RenderOptions,
} from '@testing-library/react';
import { Component, StrictMode, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { failOnConsoleNoise, nodeWrapper } from '../../../../tests/support/canvas';
import { mapOf, node } from '../../../../tests/support/map-domain';
import { MapFetch } from '../../../../tests/support/map-fetch';
import { ControlledLibrary, heldResult } from '../../../../tests/support/map-library';
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
import MapEditorError from './error';

// Design "Fixture — issue #16": MapEditor inside the provider with an injected open, over an
// InMemoryMapRepository or a stub whose get outcomes the test scripts. Every get outcome must end
// in exactly one visible state; a rejection is never presented as not-found.

failOnConsoleNoise();
afterEach(() => {
  vi.useRealTimers();
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

class EditorErrorBoundary extends Component<{ children: ReactElement }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? <MapEditorError /> : this.props.children;
  }
}

function editorOver(
  open: () => Promise<MapRepository>,
  id: string,
  wrap: (element: ReactElement) => ReactElement = (element) => element,
  options: Pick<RenderOptions, 'onCaughtError'> = {},
) {
  return render(
    wrap(
      <MapRepositoryProvider open={open}>
        <MapEditor id={id} />
      </MapRepositoryProvider>,
    ),
    options,
  );
}

// Lets the open and get promises settle and React commit what they set.
async function settled(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function throughPagehideAndUnmount(unmount: () => void, check: () => Promise<void>) {
  await check();
  act(() => {
    window.dispatchEvent(new Event('pagehide'));
  });
  await settled();
  await check();
  unmount();
  await settled();
  await check();
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

  it('shows the corrupt-record error without changing the record through pagehide and unmount', async () => {
    const corrupt = {
      ...mapOf(node('root', [], { text: '根' }), node('lost', [], { text: '无位置' })),
      id: 'corrupt',
      title: '损坏',
    };
    const repository = new ControlledLibrary();
    await repository.storage.put(corrupt);
    const onCaughtError = vi.fn();
    const { unmount } = editorOver(
      () => Promise.resolve(repository),
      corrupt.id,
      (element) => <EditorErrorBoundary>{element}</EditorErrorBoundary>,
      { onCaughtError },
    );

    expect(await screen.findByText(UNREADABLE)).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByTestId('map-editor-ready')).toBeNull();
    expect(screen.getByRole('link', { name: '返回导图列表' }).getAttribute('href')).toBe('/');
    expect(onCaughtError).toHaveBeenCalledTimes(1);
    expect(onCaughtError.mock.calls[0]?.[0]).toEqual(
      new Error('layoutForest: floating root lost has no finite position'),
    );
    await throughPagehideAndUnmount(unmount, async () => {
      expect(repository.gets).toStrictEqual(['corrupt']);
      expect(repository.lists).toBe(0);
      expect(repository.puts).toStrictEqual([]);
      expect(repository.deletes).toStrictEqual([]);
      expect(await repository.storage.get('corrupt')).toStrictEqual(corrupt);
    });
  });

  it('rejects a mismatched map identity without writes through pagehide and unmount', async () => {
    const source = {
      ...mapOf(node('source-root', [], { text: '来源内容' })),
      id: 'identity-b',
      title: '来源导图',
    };
    const originalSource = structuredClone(source);
    const peer = {
      ...mapOf(node('peer-root', [], { text: '独立内容' })),
      id: 'identity-b',
      title: '独立导图',
    };
    const repository = new ControlledLibrary();
    await repository.storage.put(peer);
    const pending = heldResult<MindMap>();
    repository.read = () => pending.promise;
    const { unmount } = editorOver(() => Promise.resolve(repository), 'identity-a');
    await settled();
    await act(async () => {
      pending.resolve(source);
      await Promise.resolve();
    });

    expect(screen.getByText(UNREADABLE)).toBeTruthy();
    expect(screen.queryByTestId('map-editor-ready')).toBeNull();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText('未保存到浏览器')).toBeNull();
    expect(screen.getByRole('link', { name: '返回导图列表' }).getAttribute('href')).toBe('/');
    await throughPagehideAndUnmount(unmount, async () => {
      expect(repository.gets).toStrictEqual(['identity-a']);
      expect(repository.lists).toBe(0);
      expect(repository.puts).toStrictEqual([]);
      expect(repository.deletes).toStrictEqual([]);
      expect(source).toStrictEqual(originalSource);
      expect(await repository.storage.get('identity-a')).toBeUndefined();
      expect(await repository.storage.get('identity-b')).toStrictEqual(peer);
    });
  });

  it('autosaves a matching identity under its own key and preserves its peer', async () => {
    const map = {
      ...mapOf(node('root', [], { text: '编辑前内容' })),
      id: 'matching-a',
      title: '编辑导图',
    };
    const peer = {
      ...mapOf(node('peer-root', [], { text: '独立内容' })),
      id: 'matching-b',
      title: '独立导图',
    };
    const repository = new ControlledLibrary();
    await repository.storage.put(map);
    await repository.storage.put(peer);
    const { unmount } = editorOver(() => Promise.resolve(repository), map.id);
    expect(await screen.findByTestId('map-editor-ready')).toBeTruthy();
    expect(nodeWrapper('root').textContent).toBe('编辑前内容');
    expect(repository.puts).toStrictEqual([]);

    vi.useFakeTimers({ now: new Date('2026-11-07T12:00:00.000Z') });
    try {
      fireEvent.doubleClick(nodeWrapper('root'));
      const input = screen.getByLabelText('节点标题');
      expect(document.activeElement).toBe(input);
      fireEvent.change(input, { target: { value: '自动保存后的内容' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(screen.queryByLabelText('节点标题')).toBeNull();
      expect(nodeWrapper('root').textContent).toBe('自动保存后的内容');
      expect(screen.getByTestId('editor-title').textContent).toBe('编辑导图');
      expect(repository.puts).toStrictEqual([]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      const saved = {
        id: 'matching-a',
        title: '编辑导图',
        roots: [{ id: 'root', text: '自动保存后的内容', children: [] }],
        createdAt: '2026-11-05T09:00:00.000Z',
        updatedAt: '2026-11-07T12:00:00.500Z',
      };
      await throughPagehideAndUnmount(unmount, async () => {
        expect(repository.gets).toStrictEqual(['matching-a']);
        expect(repository.lists).toBe(0);
        expect(repository.puts).toStrictEqual([saved]);
        expect(repository.deletes).toStrictEqual([]);
        expect(await repository.storage.get('matching-a')).toStrictEqual(saved);
        expect(await repository.storage.get('matching-b')).toStrictEqual(peer);
      });
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('shows the future-version state without changing records through pagehide and unmount', async () => {
    const repository = new ControlledLibrary();
    await repository.storage.put(SEEDED);
    repository.read = () => Promise.reject(new UnsupportedSchemaVersionError(2, 1));
    const { unmount } = editorOver(() => Promise.resolve(repository), SEEDED.id);

    expect(await screen.findByText(FUTURE_VERSION)).toBeTruthy();
    expect(screen.getByRole('link', { name: '返回导图列表' }).getAttribute('href')).toBe('/');
    expect(screen.queryByTestId('map-editor-ready')).toBeNull();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(UNREADABLE)).toBeNull();
    expect(screen.queryByText('未保存到浏览器')).toBeNull();
    await throughPagehideAndUnmount(unmount, async () => {
      expect(repository.gets).toStrictEqual([SEEDED.id]);
      expect(repository.lists).toBe(0);
      expect(repository.puts).toStrictEqual([]);
      expect(repository.deletes).toStrictEqual([]);
      expect(await repository.storage.get(SEEDED.id)).toStrictEqual(SEEDED);
    });
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

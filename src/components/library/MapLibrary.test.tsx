import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import type { MapSummary } from '../../contexts/map/domain/map-repository';
import { failOnConsoleNoise } from '../../../tests/support/canvas';
import { RecordingRepository } from '../../../tests/support/map-repository-stub';
import type { MindMap } from '../../contexts/map/domain/types';
import { heldResult, memoryLibrary } from '../../../tests/support/map-library';
import { MapLibrary } from './MapLibrary';

failOnConsoleNoise();
afterEach(() => {
  vi.useRealTimers();
});

const EARLY = '2026-11-05T10:00:00.000Z';
const LATE = '2026-11-05T11:00:00.000Z';
function stored(id: string, title: string, updatedAt: string): MindMap {
  return {
    id,
    title,
    createdAt: EARLY,
    updatedAt,
    roots: [{ id: `${id}-root`, text: '根', children: [] }],
  };
}

class LibraryWriteRepository extends RecordingRepository {
  override list() {
    return Promise.resolve([{ id: 'existing', title: 'Existing map', updatedAt: EARLY }]);
  }
}

describe('MapLibrary', () => {
  it('renders repository recency and id-tie order with titles, semantic times and encoded links', async () => {
    const repository = memoryLibrary();
    await repository.put(stored('A /?#', 'A', EARLY));
    await repository.put(stored('b', 'lowercase tie', LATE));
    await repository.put(stored('B', 'B', LATE));
    render(<MapLibrary repository={repository} navigate={vi.fn()} />);

    const rows = await screen.findAllByRole('listitem');
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual([
      'B',
      'lowercase tie',
      'A',
    ]);
    expect(rows.map((row) => row.querySelector('time')?.dateTime)).toEqual([LATE, LATE, EARLY]);
    expect(rows.map((row) => row.querySelector('time')?.textContent)).toEqual([LATE, LATE, EARLY]);
    expect(screen.getByRole('link', { name: 'A' }).getAttribute('href')).toBe(
      '/maps/A%20%2F%3F%23',
    );
    expect(screen.queryByText('还没有导图')).toBeNull();
  });

  it('keeps a pending list distinct from empty and reports a failed read', async () => {
    const pending = heldResult<MapSummary[]>();
    class UnreadableRepository extends RecordingRepository {
      override list() {
        return pending.promise;
      }
    }
    render(<MapLibrary repository={new UnreadableRepository()} navigate={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('正在加载导图…');
    expect(screen.queryByText('还没有导图')).toBeNull();
    await act(async () => {
      pending.reject(new Error('read failed'));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toBe('无法读取导图列表');
    expect(screen.queryByText('还没有导图')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a discarded list effect that settles late: %s',
    async (outcome) => {
      const stale = heldResult<MapSummary[]>();
      const current = heldResult<MapSummary[]>();
      class HeldRepository extends RecordingRepository {
        calls = 0;
        override list() {
          return this.calls++ === 0 ? stale.promise : current.promise;
        }
      }
      render(
        <StrictMode>
          <MapLibrary repository={new HeldRepository()} navigate={vi.fn()} />
        </StrictMode>,
      );
      await act(async () => {
        current.resolve([{ id: 'live', title: 'Live', updatedAt: LATE }]);
        await current.promise;
      });
      expect(screen.getByRole('link', { name: 'Live' })).toBeTruthy();
      await act(async () => {
        if (outcome === 'resolve') stale.resolve([]);
        else stale.reject(new Error('discarded read'));
        await Promise.resolve();
      });
      expect(screen.getByRole('link', { name: 'Live' })).toBeTruthy();
      expect(screen.queryByText('还没有导图')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );

  it('shows loading for a changed repository and ignores a superseded pending read', async () => {
    const old = memoryLibrary();
    await old.put(stored('old', 'Old library', EARLY));
    const pending = heldResult<MapSummary[]>();
    class HeldRepository extends RecordingRepository {
      override list() {
        return pending.promise;
      }
    }
    const view = render(<MapLibrary repository={old} navigate={vi.fn()} />);
    expect(await screen.findByRole('link', { name: 'Old library' })).toBeTruthy();
    view.rerender(<MapLibrary repository={new HeldRepository()} navigate={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('正在加载导图…');
    expect(screen.queryByRole('link')).toBeNull();
    view.rerender(<MapLibrary repository={memoryLibrary()} navigate={vi.fn()} />);
    expect(await screen.findByText('还没有导图')).toBeTruthy();
    await act(async () => {
      pending.resolve([{ id: 'stale', title: 'Stale', updatedAt: LATE }]);
      await pending.promise;
    });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('还没有导图')).toBeTruthy();
    view.unmount();
  });

  it('creates and saves the factory map with independent ids and one timestamp before opening it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T12:34:56.789Z'));
    const repository = memoryLibrary();
    const navigate = vi.fn();
    render(<MapLibrary repository={repository} navigate={navigate} />);
    await screen.findByText('还没有导图');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '新建导图' }));
      await Promise.resolve();
    });
    const summaries = await repository.list();
    expect(summaries).toHaveLength(1);
    const id = summaries[0]?.id ?? '';
    const saved = await repository.get(id);
    const rootId = saved?.roots[0]?.id ?? '';
    expect(id).toMatch(/^[\w-]{21}$/);
    expect(rootId).toMatch(/^[\w-]{21}$/);
    expect(saved).toStrictEqual({
      id,
      title: '新导图',
      createdAt: '2026-11-06T12:34:56.789Z',
      updatedAt: '2026-11-06T12:34:56.789Z',
      roots: [{ id: rootId, text: '新导图', children: [] }],
    });
    expect(saved?.roots[0]?.id).not.toBe(id);
    expect(navigate.mock.calls).toEqual([[`/maps/${id}`]]);
  });

  it('allows only one pending create and navigates once only after put resolves', async () => {
    const repository = new LibraryWriteRepository();
    const held = repository.holdNext();
    const navigate = vi.fn();
    render(<MapLibrary repository={repository} navigate={navigate} />);
    const button = await screen.findByRole('button', { name: '新建导图' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(repository.puts).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(repository.puts).toHaveLength(1);
    await act(async () => {
      held.resolve();
      await Promise.resolve();
    });
    expect(navigate.mock.calls).toEqual([[`/maps/${repository.puts[0]?.id ?? ''}`]]);
    fireEvent.click(button);
    expect(repository.puts).toHaveLength(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('retains the library on save failure and only retries after another explicit activation', async () => {
    const repository = new LibraryWriteRepository();
    const first = repository.holdNext();
    const retry = repository.holdNext();
    const navigate = vi.fn();
    render(<MapLibrary repository={repository} navigate={navigate} />);
    const button = await screen.findByRole('button', { name: '新建导图' });
    fireEvent.click(button);
    await act(async () => {
      first.reject(new Error('write failed'));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toBe('保存失败，请重试');
    expect(screen.getByRole('link', { name: 'Existing map' })).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    expect(repository.puts).toHaveLength(1);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(repository.puts).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(repository.puts[1]?.id).not.toBe(repository.puts[0]?.id);
    expect(repository.puts[1]?.roots[0]?.id).not.toBe(repository.puts[0]?.roots[0]?.id);
    await act(async () => {
      retry.resolve();
      await Promise.resolve();
    });
    expect(navigate.mock.calls).toEqual([[`/maps/${repository.puts[1]?.id ?? ''}`]]);
  });
});

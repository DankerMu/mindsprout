import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapOf, node, UPDATED_AT } from '../../../../../tests/support/map-domain';
import { RecordingRepository } from '../../../../../tests/support/map-repository-stub';
import { StorageUnavailableError } from '../../domain/errors';
import type { MindMap } from '../../domain/types';
import { AUTOSAVE_DELAY_MS, createAutosave } from './autosave';

// The autosave module's own seam (design "Fixture — issue #13"): createAutosave over a recording
// stub MapRepository and vi fake timers. The editor-store wiring (stable map, load, notice) is
// covered through createEditorStore in editor-store-autosave.test.ts.

const START = '2026-11-06T08:00:00.000Z';

function version(text: string): MindMap {
  return mapOf(node('r', [node('a', [], { text })]));
}

function setup() {
  const repository = new RecordingRepository();
  const onUnavailable = vi.fn<() => void>();
  const onFailed = vi.fn<() => void>();
  const autosave = createAutosave({
    repository,
    now: () => new Date(),
    onUnavailable,
    onFailed,
  });
  return { repository, onUnavailable, onFailed, autosave };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(START) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createAutosave', () => {
  it('is 500 ms', () => {
    expect(AUTOSAVE_DELAY_MS).toBe(500);
  });

  it('writes the last observed map, stamped, 500 ms after the last observation', () => {
    const { repository, autosave } = setup();
    autosave.rebase(version('0'));
    autosave.observe(version('1'));
    vi.advanceTimersByTime(300);
    const last = version('2');
    autosave.observe(last);
    vi.advanceTimersByTime(499);
    expect(repository.puts).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(repository.puts).toStrictEqual([{ ...last, updatedAt: '2026-11-06T08:00:00.800Z' }]);
    expect(last.updatedAt).toBe(UPDATED_AT);
  });

  it('ignores an observation of the baseline map itself', () => {
    const { repository, autosave } = setup();
    const baseline = version('0');
    autosave.rebase(baseline);
    autosave.observe(baseline);
    vi.advanceTimersByTime(1000);
    expect(repository.puts).toHaveLength(0);
  });

  it('rebase writes a pending map at once and never writes the new baseline', async () => {
    const { repository, autosave } = setup();
    autosave.rebase(version('0'));
    const edited = version('1');
    autosave.observe(edited);
    autosave.rebase(version('other'));

    expect(repository.puts).toStrictEqual([{ ...edited, updatedAt: START }]);
    await autosave.flush();
    vi.advanceTimersByTime(1000);
    expect(repository.puts).toHaveLength(1);
  });

  it('reports StorageUnavailableError as unavailable and any other rejection as failed', async () => {
    const { repository, onUnavailable, onFailed, autosave } = setup();
    autosave.rebase(version('0'));
    repository.rejectNext(new StorageUnavailableError('store closed'));
    autosave.observe(version('1'));
    await autosave.flush();
    expect([onUnavailable.mock.calls.length, onFailed.mock.calls.length]).toStrictEqual([1, 0]);

    repository.rejectNext(new Error('disk I/O'));
    autosave.observe(version('2'));
    await autosave.flush();
    expect([onUnavailable.mock.calls.length, onFailed.mock.calls.length]).toStrictEqual([1, 1]);
  });

  it('leaves a failed write pending only while its map is still the current one', async () => {
    const { repository, autosave } = setup();
    autosave.rebase(version('0'));
    const failing = version('1');
    repository.rejectNext(new Error('first'));
    autosave.observe(failing);
    await autosave.flush();
    await autosave.flush();
    expect(repository.puts.map((map) => map.roots)).toStrictEqual([failing.roots, failing.roots]);

    const held = repository.holdNext();
    const newer = version('2');
    autosave.observe(newer);
    void autosave.flush();
    autosave.observe(version('3'));
    held.reject(new Error('second'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(repository.puts.map((map) => map.roots)).toStrictEqual([
      failing.roots,
      failing.roots,
      newer.roots,
      version('3').roots,
    ]);
  });
});

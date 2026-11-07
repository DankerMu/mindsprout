import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { failOnConsoleNoise } from '../../../tests/support/canvas';
import { sampleMap, UPDATED_AT } from '../../../tests/support/map-domain';
import { ControlledLibrary, heldResult } from '../../../tests/support/map-library';
import type { Held } from '../../../tests/support/map-repository-stub';
import { UnsupportedSchemaVersionError } from '../../contexts/map/domain/errors';
import { MapLibrary } from './MapLibrary';

const NOW = '2026-11-07T12:34:56.789Z';
const TARGET = { ...sampleMap(), id: 'a', title: 'A' };
const PEER = { ...sampleMap(), id: 'b', title: 'B' };
type Mutation = 'rename' | 'delete';
type Phase = 'get' | 'put' | 'delete';

failOnConsoleNoise();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup(repository = new ControlledLibrary()) {
  await repository.storage.put(TARGET);
  await repository.storage.put(PEER);
  const navigate = vi.fn();
  const view = render(
    <StrictMode>
      <MapLibrary repository={repository} navigate={navigate} />
    </StrictMode>,
  );
  await screen.findByRole('link', { name: 'A' });
  return { repository, navigate, view };
}

function openMutation(kind: Mutation) {
  if (kind === 'delete') {
    fireEvent.click(screen.getByRole('button', { name: '删除 A' }));
    return screen.getByRole('dialog', { name: '删除 A' });
  }
  fireEvent.click(screen.getByRole('button', { name: '重命名 A' }));
  fireEvent.change(screen.getByRole('textbox', { name: '标题' }), {
    target: { value: 'Renamed' },
  });
  return screen.getByRole('form', { name: '重命名 A' });
}

async function submitMutation(kind: Mutation) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: kind === 'rename' ? '保存' : '确认删除' }));
    await Promise.resolve();
  });
}

function holdMutation(repository: ControlledLibrary, phase: Phase) {
  const pending = heldResult<Awaited<Promise<void>>>();
  if (phase === 'get') {
    repository.read = async () => {
      await pending.promise;
      return TARGET;
    };
  } else if (phase === 'put') repository.beforePut = pending.promise;
  else repository.beforeDelete = pending.promise;
  return pending;
}

async function settle(pending: Held, outcome: 'resolve' | 'reject') {
  await act(async () => {
    if (outcome === 'resolve') pending.resolve();
    else pending.reject(new Error('repository failed'));
    await Promise.resolve();
  });
}

describe.each(['rename', 'delete'] as const)('%s cancellation and serialization', (kind) => {
  it.each(['button', 'Escape'] as const)(
    'cancels with %s without I/O and restores focus',
    async (via) => {
      const { repository, navigate } = await setup();
      const listCalls = repository.lists;
      const trigger = screen.getByRole('button', {
        name: kind === 'rename' ? '重命名 A' : '删除 A',
      });
      const form = openMutation(kind);
      const cancel = within(form).getByRole('button', { name: '取消' });
      const focused = kind === 'rename' ? screen.getByRole('textbox', { name: '标题' }) : cancel;
      expect(document.activeElement).toBe(focused);
      fireEvent.blur(focused);
      fireEvent.keyDown(form, { key: 'a' });
      expect(form.isConnected).toBe(true);
      if (via === 'button') fireEvent.click(cancel);
      else fireEvent.keyDown(form, { key: 'Escape' });
      expect(form.isConnected).toBe(false);
      expect(document.activeElement).toBe(trigger);
      expect(repository.gets).toEqual([]);
      expect(repository.puts).toEqual([]);
      expect(repository.deletes).toEqual([]);
      expect(repository.lists).toBe(listCalls);
      expect(await repository.storage.get('a')).toStrictEqual(TARGET);
      expect(await repository.storage.get('b')).toStrictEqual(PEER);
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it('serializes repeated confirmation, other mutations and creation until persistence completes', async () => {
    const { repository, navigate } = await setup();
    const pending = holdMutation(repository, kind === 'rename' ? 'put' : 'delete');
    const form = openMutation(kind);
    const submit = within(form).getByRole('button', {
      name: kind === 'rename' ? '保存' : '确认删除',
    });
    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
      if (kind === 'rename') fireEvent.submit(form);
      fireEvent.keyDown(form, { key: 'Escape' });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toBe(
      kind === 'rename' ? '正在保存…' : '正在删除…',
    );
    for (const name of ['新建导图', '重命名 B', '删除 B']) {
      const button = screen.getByRole('button', { name });
      expect(button.hasAttribute('disabled')).toBe(true);
      fireEvent.click(button);
    }
    expect(form.isConnected).toBe(true);
    expect(await repository.storage.get('a')).toStrictEqual(TARGET);
    expect(repository.puts).toHaveLength(kind === 'rename' ? 1 : 0);
    expect(repository.deletes).toEqual(kind === 'delete' ? ['a'] : []);
    const listCalls = repository.lists;
    await settle(pending, 'resolve');
    expect(repository.lists).toBe(listCalls);
    expect(form.isConnected).toBe(false);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: kind === 'rename' ? '重命名 Renamed' : '新建导图' }),
    );
    expect(await repository.storage.get('b')).toStrictEqual(PEER);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('mutation failures', () => {
  it.each(['get', 'put', 'delete'] as const)(
    'retains saved rows after failed %s and retries explicitly',
    async (phase) => {
      const { repository } = await setup();
      const pending = holdMutation(repository, phase);
      const kind = phase === 'delete' ? 'delete' : 'rename';
      openMutation(kind);
      await submitMutation(kind);
      await settle(pending, 'reject');
      expect(screen.getByRole('alert').textContent).toBe('保存失败，请重试');
      expect(screen.getByRole('link', { name: 'A' })).toBeTruthy();
      const rows = screen.getAllByRole('listitem');
      expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual(['A', 'B']);
      expect(rows.map((row) => row.querySelector('time')?.textContent)).toEqual([
        UPDATED_AT,
        UPDATED_AT,
      ]);
      expect(await repository.storage.get('a')).toStrictEqual(TARGET);
      expect(await repository.storage.get('b')).toStrictEqual(PEER);
      expect(repository.gets).toHaveLength(phase === 'delete' ? 0 : 1);
      expect(repository.puts).toHaveLength(phase === 'put' ? 1 : 0);
      expect(repository.deletes).toHaveLength(phase === 'delete' ? 1 : 0);
      repository.read = undefined;
      repository.beforePut = undefined;
      repository.beforeDelete = undefined;
      await submitMutation(kind);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(await repository.storage.get('a')).toStrictEqual(
        phase === 'delete' ? undefined : { ...TARGET, title: 'Renamed', updatedAt: NOW },
      );
      expect(await repository.storage.get('b')).toStrictEqual(PEER);
    },
  );

  it.each(['missing', 'mismatched', 'future'] as const)(
    'refuses a %s rename without changing any record',
    async (kind) => {
      const { repository } = await setup();
      repository.read = () => {
        if (kind === 'future') return Promise.reject(new UnsupportedSchemaVersionError(2, 1));
        return Promise.resolve(kind === 'missing' ? undefined : PEER);
      };
      openMutation('rename');
      await submitMutation('rename');
      expect(screen.getByRole('alert').textContent).toBe(
        kind === 'future' ? '此导图由更新版本创建' : '保存失败，请重试',
      );
      expect(screen.getByRole('link', { name: 'A' })).toBeTruthy();
      expect(repository.gets).toEqual(['a']);
      expect(repository.puts).toEqual([]);
      expect(repository.deletes).toEqual([]);
      expect(await repository.storage.get('a')).toStrictEqual(TARGET);
      expect(await repository.storage.get('b')).toStrictEqual(PEER);
    },
  );

  it('deletes a visible row even when its content cannot be read', async () => {
    const { repository } = await setup();
    repository.read = () => Promise.reject(new UnsupportedSchemaVersionError(2, 1));
    openMutation('delete');
    await submitMutation('delete');
    expect(repository.gets).toEqual([]);
    expect(repository.deletes).toEqual(['a']);
    expect(await repository.storage.get('a')).toBeUndefined();
    expect(await repository.storage.get('b')).toStrictEqual(PEER);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe.each(['get', 'put', 'delete'] as const)('pending %s lifetime', (phase) => {
  describe.each(['unmount', 'replace'] as const)('%s', (ending) => {
    it.each(['resolve', 'reject'] as const)('ignores obsolete completion: %s', async (outcome) => {
      const { repository, navigate, view } = await setup();
      const pending = holdMutation(repository, phase);
      const kind = phase === 'delete' ? 'delete' : 'rename';
      openMutation(kind);
      await submitMutation(kind);
      const replacement = new ControlledLibrary();
      const currentMap = { ...TARGET, title: 'Current map' };
      await replacement.storage.put(currentMap);
      if (ending === 'unmount') view.unmount();
      else {
        view.rerender(
          <StrictMode>
            <MapLibrary repository={replacement} navigate={navigate} />
          </StrictMode>,
        );
        await screen.findByRole('link', { name: 'Current map' });
      }
      await settle(pending, outcome);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('form')).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      expect(repository.puts).toHaveLength(phase === 'put' ? 1 : 0);
      expect(repository.deletes).toEqual(phase === 'delete' ? ['a'] : []);
      expect(await repository.storage.get('a')).toStrictEqual(
        phase === 'get' || outcome === 'reject'
          ? TARGET
          : phase === 'put'
            ? { ...TARGET, title: 'Renamed', updatedAt: NOW }
            : undefined,
      );
      expect(await repository.storage.get('b')).toStrictEqual(PEER);
      expect(await replacement.storage.get('a')).toStrictEqual(currentMap);
      expect(replacement.puts).toEqual([]);
      expect(replacement.deletes).toEqual([]);
      if (ending === 'unmount') expect(view.container.innerHTML).toBe('');
      else expect(screen.getByRole('link', { name: 'Current map' })).toBeTruthy();
    });
  });
});

it('does not let an obsolete completion unlock a replacement library mutation', async () => {
  const { repository, view, navigate } = await setup();
  const obsolete = holdMutation(repository, 'put');
  openMutation('rename');
  await submitMutation('rename');
  const current = new ControlledLibrary();
  await current.storage.put(TARGET);
  await current.storage.put(PEER);
  const pending = holdMutation(current, 'delete');
  view.rerender(
    <StrictMode>
      <MapLibrary repository={current} navigate={navigate} />
    </StrictMode>,
  );
  await screen.findByRole('button', { name: '删除 A' });
  openMutation('delete');
  await submitMutation('delete');
  await settle(obsolete, 'resolve');
  expect(screen.getByRole('status').textContent).toBe('正在删除…');
  expect(screen.getByRole('button', { name: '新建导图' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('link', { name: 'A' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Renamed' })).toBeNull();
  await settle(pending, 'resolve');
  expect(screen.queryByRole('link', { name: 'A' })).toBeNull();
  expect(await current.storage.get('b')).toStrictEqual(PEER);
  expect(navigate).not.toHaveBeenCalled();
});

it('locks rename and deletion while a creation is pending', async () => {
  const { repository, navigate } = await setup();
  const pending = holdMutation(repository, 'put');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '新建导图' }));
    await Promise.resolve();
  });
  for (const name of ['重命名 A', '删除 A']) {
    const button = screen.getByRole('button', { name });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
  }
  expect(screen.queryByRole('form')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(repository.puts).toHaveLength(1);
  expect(repository.gets).toEqual([]);
  expect(repository.deletes).toEqual([]);
  await settle(pending, 'resolve');
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(await repository.storage.get('a')).toStrictEqual(TARGET);
  expect(await repository.storage.get('b')).toStrictEqual(PEER);
});

it('switches rename targets without carrying a draft or writing to the former target', async () => {
  const { repository } = await setup();
  openMutation('rename');
  fireEvent.click(screen.getByRole('button', { name: '重命名 B' }));
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: '标题' });
  expect(input.value).toBe('B');
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'B changed' } });
  await submitMutation('rename');
  expect(repository.gets).toEqual(['b']);
  expect(await repository.storage.get('a')).toStrictEqual(TARGET);
  expect(await repository.storage.get('b')).toStrictEqual({
    ...PEER,
    title: 'B changed',
    updatedAt: NOW,
  });
  expect(
    screen.getAllByRole('listitem').map((row) => within(row).getByRole('link').textContent),
  ).toEqual(['B changed', 'A']);
});

it('keeps ID tie ordering when rename shares the peer timestamp', async () => {
  const { repository } = await setup();
  vi.setSystemTime(new Date(PEER.updatedAt));
  openMutation('rename');
  await submitMutation('rename');
  expect(
    screen.getAllByRole('listitem').map((row) => within(row).getByRole('link').textContent),
  ).toEqual(['Renamed', 'B']);
  expect(await repository.storage.get('a')).toStrictEqual({
    ...TARGET,
    title: 'Renamed',
    updatedAt: PEER.updatedAt,
  });
  expect(await repository.storage.get('b')).toStrictEqual(PEER);
});

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failOnConsoleNoise } from '../../../tests/support/canvas';
import { sampleMap, UPDATED_AT } from '../../../tests/support/map-domain';
import { ControlledLibrary, heldResult } from '../../../tests/support/map-library';
import type { Held } from '../../../tests/support/map-repository-stub';
import { UnsupportedSchemaVersionError } from '../../contexts/map/domain/errors';
import { SessionNavigationScope } from '../account/session-navigation';
import { MapLibrary } from './MapLibrary';

const NOW = '2026-11-07T12:34:56.789Z';
const TARGET = { ...sampleMap(), id: 'a', title: 'A' };
const PEER = { ...sampleMap(), id: 'b', title: 'B' };
const SAME_TITLE_TARGET = { ...TARGET, title: '新导图' };
const SAME_TITLE_PEER = { ...PEER, title: '新导图' };
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

async function setup(repository = new ControlledLibrary(), maps = [TARGET, PEER]) {
  for (const map of maps) await repository.storage.put(map);
  const navigate = vi.fn();
  const view = render(<MapLibrary repository={repository} navigate={navigate} />, {
    wrapper: SessionNavigationScope,
    reactStrictMode: true,
  });
  await screen.findAllByRole('listitem');
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

async function submitMutation(kind: Mutation, container?: HTMLElement) {
  const queries = container ? within(container) : screen;
  await act(async () => {
    fireEvent.click(queries.getByRole('button', { name: kind === 'rename' ? '保存' : '确认删除' }));
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

it('renames only the second same-title map from a form in its row', async () => {
  const { repository } = await setup(new ControlledLibrary(), [SAME_TITLE_TARGET, SAME_TITLE_PEER]);
  const [first, second] = screen.getAllByRole('listitem');
  if (!first || !second) throw new Error('Missing same-title rows');
  expect(within(first).getByRole('link', { name: '新导图' }).getAttribute('href')).toBe('/maps/a');
  expect(within(second).getByRole('link', { name: '新导图' }).getAttribute('href')).toBe('/maps/b');

  fireEvent.click(within(second).getByRole('button', { name: '重命名 新导图' }));
  const form = within(second).getByRole('form', { name: '重命名 新导图' });
  expect(screen.getAllByRole('form')).toEqual([form]);
  const input = within(form).getByRole('textbox', { name: '标题' });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: '第二张导图' } });
  await submitMutation('rename', form);

  expect(repository.gets).toEqual(['b']);
  expect(repository.puts).toEqual([{ ...SAME_TITLE_PEER, title: '第二张导图', updatedAt: NOW }]);
  expect(await repository.storage.get('a')).toStrictEqual(SAME_TITLE_TARGET);
  expect(await repository.storage.get('b')).toStrictEqual({
    ...SAME_TITLE_PEER,
    title: '第二张导图',
    updatedAt: NOW,
  });
});

it('deletes only the second same-title map from a confirmation in its row', async () => {
  const { repository } = await setup(new ControlledLibrary(), [SAME_TITLE_TARGET, SAME_TITLE_PEER]);
  const second = screen.getAllByRole('listitem')[1];
  if (!second) throw new Error('Missing second same-title row');
  expect(within(second).getByRole('link', { name: '新导图' }).getAttribute('href')).toBe('/maps/b');

  fireEvent.click(within(second).getByRole('button', { name: '删除 新导图' }));
  const dialog = within(second).getByRole('dialog', { name: '删除 新导图' });
  expect(screen.getAllByRole('dialog')).toEqual([dialog]);
  expect(within(dialog).getByText('确定永久删除“新导图”吗？', { exact: true })).toBeTruthy();
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '取消' }));
  await submitMutation('delete', dialog);

  expect(repository.deletes).toEqual(['b']);
  expect(await repository.storage.get('a')).toStrictEqual(SAME_TITLE_TARGET);
  expect(await repository.storage.get('b')).toBeUndefined();
  expect(screen.getByRole('link', { name: '新导图' }).getAttribute('href')).toBe('/maps/a');
});

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

  it.each(['missing', 'mismatched'] as const)(
    'refuses a %s rename without changing any record',
    async (kind) => {
      const { repository } = await setup();
      repository.read = () => {
        return Promise.resolve(kind === 'missing' ? undefined : PEER);
      };
      openMutation('rename');
      await submitMutation('rename');
      expect(screen.getByRole('alert').textContent).toBe('保存失败，请重试');
      expect(screen.getByRole('link', { name: 'A' })).toBeTruthy();
      expect(repository.gets).toEqual(['a']);
      expect(repository.puts).toEqual([]);
      expect(repository.deletes).toEqual([]);
      expect(await repository.storage.get('a')).toStrictEqual(TARGET);
      expect(await repository.storage.get('b')).toStrictEqual(PEER);
    },
  );

  it('refuses a future-version rename, then explicitly deletes only that record without rereading it', async () => {
    const { repository } = await setup();
    const listCalls = repository.lists;
    repository.read = () => Promise.reject(new UnsupportedSchemaVersionError(2, 1));
    const form = openMutation('rename');
    await submitMutation('rename');
    expect(within(form).getByRole('alert').textContent).toBe('此导图由更新版本创建');
    expect(screen.getByRole('link', { name: 'A' })).toBeTruthy();
    expect(repository.gets).toEqual(['a']);
    expect(repository.puts).toEqual([]);
    expect(repository.deletes).toEqual([]);
    expect(await repository.storage.get('a')).toStrictEqual(TARGET);
    expect(await repository.storage.get('b')).toStrictEqual(PEER);

    fireEvent.click(within(form).getByRole('button', { name: '取消' }));
    expect(form.isConnected).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(repository.gets).toEqual(['a']);
    expect(repository.puts).toEqual([]);
    expect(repository.deletes).toEqual([]);
    expect(await repository.storage.get('a')).toStrictEqual(TARGET);
    expect(await repository.storage.get('b')).toStrictEqual(PEER);

    const dialog = openMutation('delete');
    expect(repository.deletes).toEqual([]);
    expect(await repository.storage.get('a')).toStrictEqual(TARGET);
    await submitMutation('delete');
    expect(dialog.isConnected).toBe(false);
    expect(repository.gets).toEqual(['a']);
    expect(repository.puts).toEqual([]);
    expect(repository.deletes).toEqual(['a']);
    expect(repository.lists).toBe(listCalls);
    expect(await repository.storage.get('a')).toBeUndefined();
    expect(await repository.storage.get('b')).toStrictEqual(PEER);
    expect(screen.queryByRole('link', { name: 'A' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'B' })).toBeTruthy();
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
        view.rerender(<MapLibrary repository={replacement} navigate={navigate} />);
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
  view.rerender(<MapLibrary repository={current} navigate={navigate} />);
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

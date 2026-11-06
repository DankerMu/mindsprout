import 'fake-indexeddb/auto';
import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { failOnConsoleNoise } from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import {
  MapRepositoryProvider,
  openSessionRepository,
  useMapRepository,
  type RepositoryState,
} from './MapRepositoryProvider';

failOnConsoleNoise();

it('shares the real-factory fallback promise and stored maps across replay and remount', async () => {
  const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
    throw new DOMException('Private mode', 'SecurityError');
  });
  const seen: RepositoryState[] = [];
  function Probe() {
    const state = useMapRepository();
    seen.push(state);
    return <p>{state.status}</p>;
  }
  const tree = (
    <StrictMode>
      <MapRepositoryProvider>
        <Probe />
      </MapRepositoryProvider>
    </StrictMode>
  );
  expect(renderToString(tree)).toContain('opening');
  expect(open).not.toHaveBeenCalled();
  const firstMount = render(tree);
  const promise = openSessionRepository();
  const session = await act(() => promise);
  expect(screen.getByText('ready')).toBeTruthy();
  expect(session.storageUnavailable).toBe(true);
  expect(await session.repository.list()).toStrictEqual([]);
  const map = { ...mapOf(node('session-root')), id: 'private-map' };
  await session.repository.put(map);
  firstMount.unmount();
  render(tree);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByText('ready')).toBeTruthy();
  expect(openSessionRepository()).toBe(promise);
  expect(
    seen
      .filter((state) => state.status === 'ready')
      .every((state) => state.repository === session.repository && state.storageUnavailable),
  ).toBe(true);
  expect(await session.repository.get('private-map')).toStrictEqual(map);
  expect(open).toHaveBeenCalledTimes(1);
});

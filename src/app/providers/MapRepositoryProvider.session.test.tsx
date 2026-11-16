import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { failOnConsoleNoise } from '../../../tests/support/canvas';
import { mapOf, node } from '../../../tests/support/map-domain';
import { MapFetch } from '../../../tests/support/map-fetch';
import { HttpMapRepository } from '../../contexts/map/infrastructure/persistence/http-map-repository';
import {
  MapRepositoryProvider,
  openSessionRepository,
  useMapRepository,
  type RepositoryState,
} from './MapRepositoryProvider';

failOnConsoleNoise();

afterEach(() => {
  vi.unstubAllGlobals();
});

it('shares the HTTP repository promise and stored maps across replay and remount', async () => {
  const server = new MapFetch();
  vi.stubGlobal('fetch', server.fetch);
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
  expect(server.requests).toEqual([]);
  const firstMount = render(tree);
  const promise = openSessionRepository();
  const session = await act(() => promise);
  expect(screen.getByText('ready')).toBeTruthy();
  expect(session.repository).toBeInstanceOf(HttpMapRepository);
  expect(session.storageUnavailable).toBe(false);
  expect(server.requests).toEqual([]);
  const map = { ...mapOf(node('session-root')), id: 'session-map' };
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
      .every((state) => state.repository === session.repository && !state.storageUnavailable),
  ).toBe(true);
  expect(await session.repository.get('session-map')).toStrictEqual(map);
  expect(server.requests.map(({ init }) => init?.method)).toEqual(['PUT', 'GET']);
});

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
  document.cookie = 'mindsprout_session_binding=; Path=/; Max-Age=0';
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

it('rebinds the document repository only when the account binding changes', async () => {
  const server = new MapFetch();
  vi.stubGlobal('fetch', server.fetch);
  document.cookie = 'mindsprout_session_binding=QWxpY2U; Path=/';
  const alicePromise = openSessionRepository();
  const alice = await alicePromise;
  expect(openSessionRepository()).toBe(alicePromise);
  document.cookie = 'mindsprout_session_binding=Qm9i; Path=/';
  server.authenticateAs('Bob');
  const bobPromise = openSessionRepository();
  const bob = await bobPromise;
  expect(bobPromise).not.toBe(alicePromise);
  expect(bob.repository).not.toBe(alice.repository);
  expect(openSessionRepository()).toBe(bobPromise);
  expect(server.requests).toEqual([]);
  await bob.repository.list();
  expect(new Headers(server.requests[0]?.init?.headers).get('x-mindsprout-session-binding')).toBe(
    'Qm9i',
  );
});

it('opens synchronously on account change in a mounted provider without exposing Alice state', async () => {
  const server = new MapFetch();
  vi.stubGlobal('fetch', server.fetch);
  const seen: RepositoryState[] = [];
  function Probe({ route }: { route: string }) {
    const state = useMapRepository();
    seen.push(state);
    return (
      <p>
        {route}:{state.status}
      </p>
    );
  }
  document.cookie = 'mindsprout_session_binding=QWxpY2U; Path=/';
  const view = render(
    <MapRepositoryProvider>
      <Probe route="editor" />
    </MapRepositoryProvider>,
  );
  await act(() => openSessionRepository());
  const alice = seen.at(-1);
  view.rerender(
    <MapRepositoryProvider>
      <Probe route="library" />
    </MapRepositoryProvider>,
  );
  expect(seen.at(-1)).toBe(alice);
  seen.length = 0;
  document.cookie = 'mindsprout_session_binding=Qm9i; Path=/';
  server.authenticateAs('Bob');
  view.rerender(
    <MapRepositoryProvider>
      <Probe route="bob" />
    </MapRepositoryProvider>,
  );
  const first = seen[0];
  await act(() => openSessionRepository());
  expect(first).toEqual({ status: 'opening' });
  expect(seen).not.toContain(alice);
  expect(seen.at(-1)).toMatchObject({ status: 'ready' });
  expect(screen.getByText('bob:ready')).toBeTruthy();
});

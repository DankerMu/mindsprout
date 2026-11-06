'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MapRepository } from '../../contexts/map/domain/map-repository';
import { openIndexedDbMapRepository } from '../../contexts/map/infrastructure/persistence/indexed-db-map-repository';

// The session's MapRepository (design D7, "Fixture — issue #16"), mounted by the root layout so
// the library and the editor share one instance across client-side navigations. In 6.2 a failed
// open is the `failed` state; the in-memory fallback and its banner are 6.3 (#17).

export type RepositoryState =
  { status: 'opening' } | { status: 'ready'; repository: MapRepository } | { status: 'failed' };

let session: Promise<MapRepository> | undefined;

// One open per browser session; a rejected open stays rejected. Called from an effect only: SSR
// evaluates this module too, and there indexedDB is undefined (#11 handoff).
export function openSessionRepository(): Promise<MapRepository> {
  session ??= openIndexedDbMapRepository();
  return session;
}

const RepositoryContext = createContext<RepositoryState | null>(null);

export function MapRepositoryProvider({
  children,
  open = openSessionRepository,
}: {
  children: ReactNode;
  open?: () => Promise<MapRepository>;
}) {
  const [state, setState] = useState<RepositoryState>({ status: 'opening' });
  useEffect(() => {
    let cancelled = false;
    open().then(
      (repository) => {
        if (!cancelled) setState({ status: 'ready', repository });
      },
      () => {
        if (!cancelled) setState({ status: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open]);
  return <RepositoryContext value={state}>{children}</RepositoryContext>;
}

export function useMapRepository(): RepositoryState {
  const state = useContext(RepositoryContext);
  if (state === null) throw new Error('useMapRepository must be used inside MapRepositoryProvider');
  return state;
}

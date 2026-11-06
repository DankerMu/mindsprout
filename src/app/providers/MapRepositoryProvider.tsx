'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { StorageUnavailableError } from '../../contexts/map/domain/errors';
import type { MapRepository } from '../../contexts/map/domain/map-repository';
import { openIndexedDbMapRepository } from '../../contexts/map/infrastructure/persistence/indexed-db-map-repository';
import { InMemoryMapRepository } from '../../contexts/map/infrastructure/persistence/in-memory-map-repository';

interface ReadyRepository {
  repository: MapRepository;
  storageUnavailable: boolean;
}

export type RepositoryState =
  { status: 'opening' } | ({ status: 'ready' } & ReadyRepository) | { status: 'failed' };

let session: Promise<ReadyRepository> | undefined;

async function openRepository(open: () => Promise<MapRepository>): Promise<ReadyRepository> {
  try {
    return { repository: await open(), storageUnavailable: false };
  } catch (error) {
    if (!(error instanceof StorageUnavailableError)) throw error;
    return { repository: new InMemoryMapRepository(), storageUnavailable: true };
  }
}

// Effect-only open: SSR never touches IndexedDB. The chosen repository (or failure) lasts
// for this document session, including provider remounts and client-side navigation.
export function openSessionRepository(): Promise<ReadyRepository> {
  session ??= openRepository(openIndexedDbMapRepository);
  return session;
}

const RepositoryContext = createContext<RepositoryState | null>(null);

export function MapRepositoryProvider({
  children,
  open,
}: {
  children: ReactNode;
  open?: () => Promise<MapRepository>;
}) {
  const [state, setState] = useState<RepositoryState>({ status: 'opening' });
  useEffect(() => {
    let cancelled = false;
    const opening = open === undefined ? openSessionRepository() : openRepository(open);
    opening.then(
      (ready) => {
        if (!cancelled) setState({ status: 'ready', ...ready });
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

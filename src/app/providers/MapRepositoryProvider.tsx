'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { StorageUnavailableError } from '../../contexts/map/domain/errors';
import type { MapRepository } from '../../contexts/map/domain/map-repository';
import { HttpMapRepository } from '../../contexts/map/infrastructure/persistence/http-map-repository';
import { InMemoryMapRepository } from '../../contexts/map/infrastructure/persistence/in-memory-map-repository';
import { readCookie, SESSION_BINDING_COOKIE } from '../../shared/session-binding';

interface ReadyRepository {
  repository: MapRepository;
  storageUnavailable: boolean;
}

export type RepositoryState =
  { status: 'opening' } | ({ status: 'ready' } & ReadyRepository) | { status: 'failed' };

let session: { binding: string | undefined; promise: Promise<ReadyRepository> } | undefined;

function documentBinding(): string | undefined {
  return typeof document === 'undefined'
    ? undefined
    : readCookie(document.cookie, SESSION_BINDING_COOKIE);
}

async function openRepository(open: () => Promise<MapRepository>): Promise<ReadyRepository> {
  try {
    return { repository: await open(), storageUnavailable: false };
  } catch (error) {
    if (!(error instanceof StorageUnavailableError)) throw error;
    return { repository: new InMemoryMapRepository(), storageUnavailable: true };
  }
}

// Effect-only open: SSR issues no request. Remounts share the repository until the account changes.
export function openSessionRepository(): Promise<ReadyRepository> {
  const binding = documentBinding();
  if (!session || session.binding !== binding) {
    session = {
      binding,
      promise: openRepository(() => Promise.resolve(new HttpMapRepository(undefined, binding))),
    };
  }
  return session.promise;
}

const RepositoryContext = createContext<RepositoryState | null>(null);

interface ProviderProps {
  children: ReactNode;
  open?: () => Promise<MapRepository>;
}

export function MapRepositoryProvider(props: ProviderProps) {
  // Shared layouts do not rerender for changed route children; subscribe to navigation.
  usePathname();
  const binding = props.open === undefined ? documentBinding() : undefined;
  // Reset before child effects can use another account's ready repository (decision 0028).
  return <RepositoryProvider key={binding} {...props} />;
}

function RepositoryProvider({ children, open }: ProviderProps) {
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

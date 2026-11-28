'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import {
  isSignOutPending,
  resumeFromPublicAuth,
  SessionNavigationScope,
} from '../../components/account/session-navigation';
import type { GenerateSource } from '../../contexts/map/domain/generate-source';
import type { MapRepository } from '../../contexts/map/domain/map-repository';
import { HttpGenerateSource } from '../../contexts/map/infrastructure/ai/http-generate-source';
import { HttpMapRepository } from '../../contexts/map/infrastructure/persistence/http-map-repository';
import { readCookie, SESSION_BINDING_COOKIE } from '../../shared/session-binding';

// The injected open path (tests) composes no generate source.
interface ReadyRepository {
  repository: MapRepository;
  generateSource?: GenerateSource;
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
  return { repository: await open() };
}

// Effect-only open: SSR issues no request. Remounts share the repository until the account changes.
// Both adapters carry the same binding, so an absent cookie fails closed for generation too
// (decision 0028). The executor turns a throwing constructor into a failed open.
export function openSessionRepository(): Promise<ReadyRepository> {
  const binding = documentBinding();
  if (!session || session.binding !== binding) {
    const bound = binding ?? '';
    session = {
      binding,
      promise: new Promise((resolve) => {
        resolve({
          repository: new HttpMapRepository(undefined, bound),
          generateSource: new HttpGenerateSource(undefined, bound),
        });
      }),
    };
  }
  return session.promise;
}

const RepositoryContext = createContext<RepositoryState | null>(null);

interface ProviderProps {
  children: ReactNode;
  open?: () => Promise<MapRepository>;
}

function isPublicAuthPath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/register';
}

export function MapRepositoryProvider(props: ProviderProps) {
  // Shared layouts do not rerender for changed route children; subscribe to navigation.
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  // Commit the route boundary before protected request effects capture their epoch.
  useLayoutEffect(() => {
    const from = previousPathname.current;
    previousPathname.current = pathname;
    if (!from || !pathname || from === pathname || isPublicAuthPath(pathname)) return;
    if (isPublicAuthPath(from)) {
      resumeFromPublicAuth();
    } else if (isSignOutPending()) {
      // A document replacement cannot be discarded by another App Router transition.
      window.location.replace('/login');
    }
  }, [pathname]);
  const binding = props.open === undefined ? documentBinding() : undefined;
  // Reset before child effects can use another account's ready repository (decision 0028).
  return (
    <SessionNavigationScope>
      <RepositoryProvider key={binding} {...props} />
    </SessionNavigationScope>
  );
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

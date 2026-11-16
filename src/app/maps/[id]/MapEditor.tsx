'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { EditorSession } from '../../../components/editor/EditorSession';
import { EditorView } from '../../../components/editor/EditorView';
import {
  StorageUnauthorizedError,
  UnsupportedSchemaVersionError,
} from '../../../contexts/map/domain/errors';
import type { MapRepository } from '../../../contexts/map/domain/map-repository';
import type { MindMap } from '../../../contexts/map/domain/types';
import { useMapRepository } from '../../providers/MapRepositoryProvider';
import { MapStatus, type MapStatusKind } from './MapStatus';

// A failed read never means not-found and never selects a different repository.
type Loaded = { status: MapStatusKind } | { status: 'ready'; map: MindMap };

function statusOf(error: unknown): MapStatusKind {
  return error instanceof UnsupportedSchemaVersionError ? 'future-version' : 'error';
}

function StoredMap({
  id,
  repository,
  header,
}: {
  id: string;
  repository: MapRepository;
  header?: ReactNode;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  useEffect(() => {
    // An unmounted (or StrictMode-discarded) effect's late result must never be shown.
    let cancelled = false;
    repository.get(id).then(
      (map) => {
        if (cancelled) return;
        if (map === undefined) {
          setLoaded({ status: 'not-found' });
        } else if (map.id !== id) {
          setLoaded({ status: 'error' });
        } else {
          setLoaded({ status: 'ready', map });
        }
      },
      (error: unknown) => {
        if (cancelled) return;
        if (error instanceof StorageUnauthorizedError) {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Decision 0025: expired loads require a fresh document.
          window.location.assign('/login?next=' + encodeURIComponent(window.location.pathname));
          return;
        }
        setLoaded({
          status: statusOf(error),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, repository]);
  if (loaded.status !== 'ready') return <MapStatus kind={loaded.status} />;
  return (
    <EditorSession map={loaded.map} repository={repository}>
      <EditorView header={header} />
    </EditorSession>
  );
}

export function MapEditor({ id, header }: { id: string; header?: ReactNode }) {
  const repository = useMapRepository();
  if (repository.status === 'opening') return <MapStatus kind="loading" />;
  if (repository.status === 'failed') return <MapStatus kind="error" />;
  return <StoredMap key={id} id={id} repository={repository.repository} header={header} />;
}

'use client';

import { useEffect, useState } from 'react';
import { EditorSession } from '../../../components/editor/EditorSession';
import { EditorView } from '../../../components/editor/EditorView';
import { UnsupportedSchemaVersionError } from '../../../contexts/map/domain/errors';
import type { MapRepository } from '../../../contexts/map/domain/map-repository';
import type { MindMap } from '../../../contexts/map/domain/types';
import { useMapRepository } from '../../providers/MapRepositoryProvider';
import { MapStatus, type MapStatusKind } from './MapStatus';

// Loads one map for /maps/[id] (design D8, "Fixture — issue #16"). Every outcome of get ends in
// exactly one visible state: undefined is not-found, a newer schema is future-version, and any
// other rejection (StorageUnavailableError included until 6.3) is the error state, never
// not-found. Nothing here writes; a corrupt map that throws while rendering reaches error.tsx.

type Loaded = { status: MapStatusKind } | { status: 'ready'; map: MindMap };

function statusOf(error: unknown): MapStatusKind {
  return error instanceof UnsupportedSchemaVersionError ? 'future-version' : 'error';
}

function StoredMap({ id, repository }: { id: string; repository: MapRepository }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  useEffect(() => {
    // An unmounted (or StrictMode-discarded) effect's late result must never be shown.
    let cancelled = false;
    repository.get(id).then(
      (map) => {
        if (!cancelled)
          setLoaded(map === undefined ? { status: 'not-found' } : { status: 'ready', map });
      },
      (error: unknown) => {
        if (!cancelled) setLoaded({ status: statusOf(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, repository]);
  if (loaded.status !== 'ready') return <MapStatus kind={loaded.status} />;
  return (
    <EditorSession map={loaded.map} repository={repository}>
      <EditorView />
    </EditorSession>
  );
}

export function MapEditor({ id }: { id: string }) {
  const repository = useMapRepository();
  if (repository.status === 'opening') return <MapStatus kind="loading" />;
  if (repository.status === 'failed') return <MapStatus kind="error" />;
  return <StoredMap id={id} repository={repository.repository} />;
}

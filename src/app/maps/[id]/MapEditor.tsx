'use client';

import { useEffect, useState } from 'react';
import { EditorSession } from '../../../components/editor/EditorSession';
import { EditorView } from '../../../components/editor/EditorView';
import { StorageUnavailableBanner } from '../../../components/StorageUnavailableBanner';
import {
  StorageUnavailableError,
  UnsupportedSchemaVersionError,
} from '../../../contexts/map/domain/errors';
import type { MapRepository } from '../../../contexts/map/domain/map-repository';
import type { MindMap } from '../../../contexts/map/domain/types';
import { useMapRepository } from '../../providers/MapRepositoryProvider';
import { MapStatus, type MapStatusKind } from './MapStatus';

// A failed read never means not-found and never selects a different repository.
type Loaded =
  { status: MapStatusKind; storageUnavailable?: boolean } | { status: 'ready'; map: MindMap };

function statusOf(error: unknown): MapStatusKind {
  return error instanceof UnsupportedSchemaVersionError ? 'future-version' : 'error';
}

function StoredMap({
  id,
  repository,
  storageUnavailable,
}: {
  id: string;
  repository: MapRepository;
  storageUnavailable: boolean;
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
        if (!cancelled)
          setLoaded({
            status: statusOf(error),
            storageUnavailable: error instanceof StorageUnavailableError,
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, repository]);
  if (loaded.status !== 'ready')
    return (
      <>
        <StorageUnavailableBanner
          storageUnavailable={storageUnavailable || loaded.storageUnavailable === true}
        />
        <MapStatus kind={loaded.status} />
      </>
    );
  return (
    <EditorSession map={loaded.map} repository={repository}>
      <EditorView storageUnavailable={storageUnavailable} />
    </EditorSession>
  );
}

export function MapEditor({ id }: { id: string }) {
  const repository = useMapRepository();
  if (repository.status === 'opening') return <MapStatus kind="loading" />;
  if (repository.status === 'failed') return <MapStatus kind="error" />;
  return (
    <StoredMap
      key={id}
      id={id}
      repository={repository.repository}
      storageUnavailable={repository.storageUnavailable}
    />
  );
}

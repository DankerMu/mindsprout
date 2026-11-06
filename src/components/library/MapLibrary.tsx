import { nanoid } from 'nanoid';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createMindMap } from '../../contexts/map/domain/create-mind-map';
import type { MapRepository, MapSummary } from '../../contexts/map/domain/map-repository';

interface LibraryLifetime {
  cancelled: boolean;
  creating: boolean;
}

function isCancelled(lifetime: LibraryLifetime): boolean {
  return lifetime.cancelled;
}

type LibraryState = { repository: MapRepository } & (
  { status: 'error' } | { status: 'ready'; maps: MapSummary[]; lifetime: LibraryLifetime }
);

export function MapLibrary({
  repository,
  navigate,
}: {
  repository: MapRepository;
  navigate: (href: string) => void;
}) {
  const [loaded, setLoaded] = useState<LibraryState | null>(null);
  const activeLifetime = useRef<LibraryLifetime | null>(null);
  const [creation, setCreation] = useState<{
    lifetime: LibraryLifetime;
    status: 'pending' | 'failed';
  } | null>(null);
  useEffect(() => {
    const lifetime: LibraryLifetime = { cancelled: false, creating: false };
    activeLifetime.current = lifetime;
    void repository.list().then(
      (maps) => {
        if (!lifetime.cancelled) setLoaded({ status: 'ready', maps, repository, lifetime });
      },
      () => {
        if (!lifetime.cancelled) setLoaded({ status: 'error', repository });
      },
    );
    return () => {
      lifetime.cancelled = true;
    };
  }, [repository]);
  async function create() {
    const lifetime = activeLifetime.current;
    if (lifetime === null || isCancelled(lifetime) || lifetime.creating) return;
    lifetime.creating = true;
    setCreation({ lifetime, status: 'pending' });
    const map = createMindMap({
      id: nanoid(),
      rootId: nanoid(),
      title: '新导图',
      rootText: '新导图',
    });
    try {
      await repository.put(map);
    } catch {
      if (isCancelled(lifetime)) return;
      lifetime.creating = false;
      setCreation({ lifetime, status: 'failed' });
      return;
    }
    if (!isCancelled(lifetime)) navigate(`/maps/${encodeURIComponent(map.id)}`);
  }
  if (loaded?.repository !== repository) return <p role="status">正在加载导图…</p>;
  if (loaded.status === 'error') return <p role="alert">无法读取导图列表</p>;
  const creationStatus = creation?.lifetime === loaded.lifetime ? creation.status : 'idle';
  return (
    <section aria-label="导图列表">
      <button
        type="button"
        disabled={creationStatus === 'pending'}
        onClick={() => {
          void create();
        }}
      >
        新建导图
      </button>
      {creationStatus === 'failed' && <p role="alert">保存失败，请重试</p>}
      {loaded.maps.length === 0 && <p>还没有导图</p>}
      <ul>
        {loaded.maps.map(({ id, title, updatedAt }) => (
          <li key={id}>
            <Link href={`/maps/${encodeURIComponent(id)}`}>{title}</Link>
            {' — '}
            <time dateTime={updatedAt}>{updatedAt}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}

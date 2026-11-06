import { nanoid } from 'nanoid';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createMindMap } from '../../contexts/map/domain/create-mind-map';
import type { MapRepository, MapSummary } from '../../contexts/map/domain/map-repository';

type LibraryState = { repository: MapRepository } & (
  { status: 'error' } | { status: 'ready'; maps: MapSummary[] }
);

export function MapLibrary({
  repository,
  navigate,
}: {
  repository: MapRepository;
  navigate: (href: string) => void;
}) {
  const [loaded, setLoaded] = useState<LibraryState | null>(null);
  const creating = useRef(false);
  const [creation, setCreation] = useState<'idle' | 'pending' | 'failed'>('idle');
  useEffect(() => {
    let cancelled = false;
    void repository.list().then(
      (maps) => {
        if (!cancelled) setLoaded({ status: 'ready', maps, repository });
      },
      () => {
        if (!cancelled) setLoaded({ status: 'error', repository });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repository]);
  async function create() {
    if (creating.current) return;
    creating.current = true;
    setCreation('pending');
    const map = createMindMap({
      id: nanoid(),
      rootId: nanoid(),
      title: '新导图',
      rootText: '新导图',
    });
    try {
      await repository.put(map);
    } catch {
      creating.current = false;
      setCreation('failed');
      return;
    }
    navigate(`/maps/${encodeURIComponent(map.id)}`);
  }
  if (loaded?.repository !== repository) return <p role="status">正在加载导图…</p>;
  if (loaded.status === 'error') return <p role="alert">无法读取导图列表</p>;
  return (
    <section aria-label="导图列表">
      <button
        type="button"
        disabled={creation === 'pending'}
        onClick={() => {
          void create();
        }}
      >
        新建导图
      </button>
      {creation === 'failed' && <p role="alert">保存失败，请重试</p>}
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

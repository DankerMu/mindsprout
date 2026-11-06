import Link from 'next/link';

// The /maps/[id] states other than the editor itself (design "Fixture — issue #16"): specs
// map-library "Stale link" / "Unreadable map" and map-persistence "Future version". error.tsx
// reuses the error state for render-time throws.

export type MapStatusKind = 'loading' | 'not-found' | 'future-version' | 'error';

const MESSAGES: Record<MapStatusKind, string> = {
  loading: '正在打开…',
  'not-found': '找不到这张导图',
  'future-version': '此导图由更新版本创建',
  error: '无法打开这张导图',
};

export function MapStatus({ kind }: { kind: MapStatusKind }) {
  return (
    <main>
      <p>{MESSAGES[kind]}</p>
      {kind !== 'loading' && <Link href="/">返回导图列表</Link>}
    </main>
  );
}

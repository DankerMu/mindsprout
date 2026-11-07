'use client';

import { useRouter } from 'next/navigation';
import { MapLibrary } from '../components/library/MapLibrary';
import { StorageUnavailableBanner } from '../components/StorageUnavailableBanner';
import { useMapRepository } from './providers/MapRepositoryProvider';

export function MapLibraryClient() {
  const state = useMapRepository();
  const router = useRouter();
  if (state.status === 'opening') return <p role="status">正在加载导图…</p>;
  if (state.status === 'failed') return <p role="alert">无法读取导图列表</p>;
  return (
    <>
      <StorageUnavailableBanner storageUnavailable={state.storageUnavailable} />
      <MapLibrary
        repository={state.repository}
        navigate={(href) => {
          router.push(href);
        }}
      />
    </>
  );
}

'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import {
  createEditorStore,
  type EditorState,
} from '../../contexts/map/application/editor-store/editor-store';
import type { MapRepository } from '../../contexts/map/domain/map-repository';
import type { MindMap } from '../../contexts/map/domain/types';

// One editor store per opened map (design D7, "Fixture — issue #16"): created on mount with the
// session repository, loaded with the stored map (load is not an edit, so opening writes nothing),
// and flushed when the page is hidden or the editor unmounts. Client-side navigation fires no
// pagehide (#10 handoff), hence the unmount flush. flush reaches repository.put synchronously, so
// a later read in another transaction is ordered after the write (#11, #13 handoffs).

const EditorStoreContext = createContext<StoreApi<EditorState> | null>(null);

export function EditorSession({
  map,
  repository,
  children,
}: {
  map: MindMap;
  repository: MapRepository;
  children: ReactNode;
}) {
  const [store] = useState(() => {
    const created = createEditorStore({ repository });
    created.getState().load(map);
    return created;
  });
  useEffect(() => {
    const flush = (): void => {
      void store.getState().flush();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [store]);
  return <EditorStoreContext value={store}>{children}</EditorStoreContext>;
}

export function useEditorStoreApi(): StoreApi<EditorState> {
  const store = useContext(EditorStoreContext);
  if (store === null) throw new Error('useEditorStore must be used inside EditorSession');
  return store;
}

// The React binding of the session's store.
export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  return useStore(useEditorStoreApi(), selector);
}

// The session's map. EditorSession loads one before providing the store and no action unloads it,
// so a null map here is a programming error, not a state to render.
export function selectMap(state: EditorState): MindMap {
  if (state.map === null) throw new Error('selectMap: the editor store has no map loaded');
  return state.map;
}

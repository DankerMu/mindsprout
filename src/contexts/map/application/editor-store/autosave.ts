import { StorageUnavailableError } from '../../domain/errors';
import type { MapRepository } from '../../domain/map-repository';
import type { MindMap } from '../../domain/types';

// Debounced map writes for the editor store (design D7, "Fixture — issue #13"). The store feeds
// it only stable maps (observed outside an open History group) and each load's baseline; this
// module decides when to put and classifies failures. It never touches store state itself.

// Spec "Autosave after every change": a map is persisted within 500 ms of the last change.
export const AUTOSAVE_DELAY_MS = 500;

interface AutosaveOptions {
  readonly repository: MapRepository;
  readonly now: () => Date;
  // A put rejected with StorageUnavailableError (the store became unusable mid-session).
  readonly onUnavailable: () => void;
  // A put rejected with anything else (quota, a dropped connection, ...).
  readonly onFailed: () => void;
}

export interface Autosave {
  // A stable map was observed; a new identity restarts the debounce timer.
  observe(map: MindMap): void;
  // load: start the write of a pending map, then take `map` as the unwritten-but-saved baseline.
  rebase(map: MindMap): void;
  // Write a pending map now; resolves once that write settles and never rejects.
  flush(): Promise<void>;
}

export function createAutosave(options: AutosaveOptions): Autosave {
  const { repository, now, onUnavailable, onFailed } = options;
  // Pending = the stable map is not the map the last write started with (identity, never deep
  // equality: only a new map object is a change).
  let stable: MindMap | null = null;
  let written: MindMap | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };

  // Stamped when the write starts; the stamp stays out of the store, so map identity is unchanged
  // for subscribers and the write cannot schedule another one. Concurrent writes are not
  // serialised: storage keeps them in start order. A failed map becomes pending again only while
  // it is still the stable map, so a newer change or a load is never overwritten by a retry.
  const write = async (sent: MindMap): Promise<void> => {
    clearTimer();
    written = sent;
    try {
      await repository.put({ ...sent, updatedAt: now().toISOString() });
    } catch (error) {
      if (stable === sent) written = null;
      if (error instanceof StorageUnavailableError) onUnavailable();
      else onFailed();
    }
  };

  const writePending = (): Promise<void> =>
    stable !== null && stable !== written ? write(stable) : Promise.resolve();

  return {
    observe(map) {
      if (map === stable) return;
      stable = map;
      clearTimer();
      timer = setTimeout(() => void writePending(), AUTOSAVE_DELAY_MS);
    },

    rebase(map) {
      void writePending();
      clearTimer();
      stable = map;
      written = map;
    },

    flush: writePending,
  };
}

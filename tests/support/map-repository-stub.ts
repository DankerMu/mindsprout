import type { MapRepository, MapSummary } from '../../src/contexts/map/domain/map-repository';
import type { MindMap } from '../../src/contexts/map/domain/types';

// MapRepository stub for the autosave tests (design "Fixture — issue #13"): records every map
// handed to put, in call order and as given, and settles each put as scripted (resolved unless a
// rejection or a hold was queued). Autosave only writes, so the readers fail loudly if called.

export interface Held {
  resolve(): void;
  reject(error: Error): void;
}

export class RecordingRepository implements MapRepository {
  readonly puts: MindMap[] = [];
  readonly #outcomes: (() => Promise<void>)[] = [];

  // The next put rejects with `error`.
  rejectNext(error: Error): void {
    this.#outcomes.push(() => Promise.reject(error));
  }

  // The next put stays pending until the returned handle settles it.
  holdNext(): Held {
    const held: Held = { resolve: unsettled, reject: unsettled };
    this.#outcomes.push(
      () =>
        new Promise<void>((resolve, reject) => {
          held.resolve = resolve;
          held.reject = reject;
        }),
    );
    return held;
  }

  put(map: MindMap): Promise<void> {
    this.puts.push(map);
    const outcome = this.#outcomes.shift();
    return outcome === undefined ? Promise.resolve() : outcome();
  }

  list(): Promise<MapSummary[]> {
    return Promise.reject(new Error('autosave must not list'));
  }

  get(): Promise<MindMap | undefined> {
    return Promise.reject(new Error('autosave must not get'));
  }

  delete(): Promise<void> {
    return Promise.reject(new Error('autosave must not delete'));
  }
}

function unsettled(): void {
  throw new Error('the held put has not been called yet');
}

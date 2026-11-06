'use client';

import { MapStatus } from './MapStatus';

// Segment error boundary for /maps/[id] (spec map-library "Unreadable map"): a render-time throw,
// such as layoutForest's "floating root <id> has no finite position" for a corrupt stored record,
// ends in the error state, never not-found or a blank page. Next passes { error, retry }
// (error.md); every throw shows the same state, so neither is read.
export default function MapEditorError() {
  return <MapStatus kind="error" />;
}

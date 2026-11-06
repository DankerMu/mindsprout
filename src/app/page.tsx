import { MapLibraryClient } from './MapLibraryClient';

export default function HomePage() {
  return (
    <main data-testid="app-ready">
      <h1>MindSprout</h1>
      <MapLibraryClient />
    </main>
  );
}

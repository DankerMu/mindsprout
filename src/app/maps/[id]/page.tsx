import { MapEditor } from './MapEditor';

// /maps/[id] (design D8). Next 16 passes params as a Promise. The key remounts the editor for
// another id, so a new map never inherits the previous editor session.
export default async function MapEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MapEditor key={id} id={id} />;
}

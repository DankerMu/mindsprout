import { SessionMenu } from '../components/account/SessionMenu';
import styles from '../components/list-page.module.css';
import { MapLibraryClient } from './MapLibraryClient';

export default function HomePage() {
  return (
    <main className={styles.page} data-testid="app-ready">
      <h1>MindSprout</h1>
      <SessionMenu />
      <MapLibraryClient />
    </main>
  );
}

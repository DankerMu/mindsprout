import Link from 'next/link';
import { AdminUserList } from '../../components/account/AdminUserList';
import { SessionMenu } from '../../components/account/SessionMenu';
import styles from '../../components/list-page.module.css';

export default function AdminPage() {
  return (
    <main className={styles.page} data-testid="admin-ready">
      <h1>管理后台</h1>
      <Link href="/">返回导图列表</Link>
      <SessionMenu />
      <AdminUserList />
    </main>
  );
}

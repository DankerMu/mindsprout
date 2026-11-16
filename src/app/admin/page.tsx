import { AdminUserList } from '../../components/account/AdminUserList';
import { SessionMenu } from '../../components/account/SessionMenu';

export default function AdminPage() {
  return (
    <main data-testid="admin-ready">
      <h1>管理后台</h1>
      <SessionMenu />
      <AdminUserList />
    </main>
  );
}

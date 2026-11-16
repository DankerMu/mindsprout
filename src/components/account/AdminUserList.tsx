'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface AccountInfo {
  id: string;
  username: string;
  createdAt: string;
  isAdmin: boolean;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'forbidden' }
  | { status: 'expired' }
  | { status: 'error' }
  | { status: 'ready'; accounts: AccountInfo[] };

export function AdminUserList() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    const isCurrent = () => !cancelled;
    async function load() {
      try {
        const response = await fetch('/api/admin/users');
        if (!isCurrent()) return;
        if (response.status === 401) {
          setState({ status: 'expired' });
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Decision 0025: expired loads require a fresh document.
          window.location.assign('/login?next=%2Fadmin');
        } else if (response.status === 403) {
          setState({ status: 'forbidden' });
        } else if (response.status === 200) {
          const accounts = (await response.json()) as AccountInfo[];
          if (isCurrent()) setState({ status: 'ready', accounts });
        } else {
          setState({ status: 'error' });
        }
      } catch {
        if (isCurrent()) setState({ status: 'error' });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') return <p role="status">正在读取用户列表</p>;
  if (state.status === 'expired') return null;
  if (state.status === 'forbidden') {
    return (
      <p>
        无权访问 <Link href="/">返回首页</Link>
      </p>
    );
  }
  if (state.status === 'error') return <p role="alert">无法读取用户列表</p>;
  return (
    <ul aria-label="用户列表">
      {state.accounts.map(({ id, username, createdAt, isAdmin }) => (
        <li key={id}>
          <span>{username}</span> <time dateTime={createdAt}>{createdAt}</time>{' '}
          {isAdmin && <span>管理员</span>}
        </li>
      ))}
    </ul>
  );
}

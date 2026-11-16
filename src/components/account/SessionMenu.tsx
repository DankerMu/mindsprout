'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import styles from './SessionMenu.module.css';

interface SessionInfo {
  username: string;
  isAdmin: boolean;
}

async function loadSession(): Promise<SessionInfo | undefined> {
  try {
    const response = await fetch('/api/auth/session');
    return response.ok ? ((await response.json()) as SessionInfo) : undefined;
  } catch {
    return undefined;
  }
}

export function SessionMenu() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [session, setSession] = useState<SessionInfo>();
  const request = useRef<Promise<SessionInfo | undefined>>(undefined);
  useEffect(() => {
    let cancelled = false;
    request.current ??= loadSession();
    void request.current.then((result) => {
      if (!cancelled) setSession(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (response.ok) {
        router.push('/login');
        return;
      }
    } catch {
      // Network failure leaves the current session menu available.
    }
    setFailed(true);
  }

  return session ? (
    <div className={styles.menu}>
      <span data-testid="session-username">{session.username}</span>
      {session.isAdmin && <Link href="/admin">管理后台</Link>}
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
      >
        退出登录
      </button>
      {failed && <span role="alert">请求失败，请重试</span>}
    </div>
  ) : null;
}

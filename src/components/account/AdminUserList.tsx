'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSessionNavigation } from './session-navigation';

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

type ResetState =
  { status: 'idle' | 'pending' | 'error' } | { status: 'secret'; temporaryPassword: string };

function loginAfterExpiry() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Decision 0025: admin expiry requires a fresh document.
  window.location.assign('/login?next=%2Fadmin');
}

function TemporaryPassword({ password, onClose }: { password: string; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <dialog
      open
      aria-label="临时密码"
      aria-describedby="temporary-password-guidance"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
      }}
    >
      <p id="temporary-password-guidance">
        临时密码仅显示一次，请选中并复制保存；关闭后将不再显示。
      </p>
      <label>
        临时密码
        <input
          ref={input}
          readOnly
          autoComplete="off"
          value={password}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onClick={(event) => {
            event.currentTarget.select();
          }}
          onMouseUp={(event) => {
            event.preventDefault();
          }}
        />
      </label>
      <button type="button" onClick={onClose}>
        关闭
      </button>
    </dialog>
  );
}
export function AdminUserList() {
  const { captureEpoch, canRedirectOnExpiry } = useSessionNavigation();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reset, setReset] = useState<ResetState>({ status: 'idle' });
  const locked = useRef(false);
  const mounted = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const isCurrent = () => !cancelled;
    async function load() {
      const epoch = captureEpoch();
      try {
        const response = await fetch('/api/admin/users');
        if (!isCurrent()) return;
        if (response.status === 401) {
          setState({ status: 'expired' });
          if (canRedirectOnExpiry(epoch)) loginAfterExpiry();
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
      mounted.current = false;
    };
  }, [captureEpoch, canRedirectOnExpiry]);

  async function resetPassword(id: string, username: string, button: HTMLButtonElement) {
    if (
      locked.current ||
      !window.confirm(`确定重置 ${username} 的密码吗？重置后该用户的所有登录将失效`)
    )
      return;
    locked.current = true;
    trigger.current = button;
    setReset({ status: 'pending' });
    const isCurrent = () => mounted.current;
    const epoch = captureEpoch();
    try {
      const response = await fetch(`/api/admin/users/${id}/password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!isCurrent()) return;
      if (response.status === 401) {
        setReset({ status: 'idle' });
        setState({ status: 'expired' });
        if (canRedirectOnExpiry(epoch)) loginAfterExpiry();
        return;
      }
      if (response.status !== 200) throw new Error('Reset failed');
      const { temporaryPassword } = (await response.json()) as { temporaryPassword: string };
      if (isCurrent()) setReset({ status: 'secret', temporaryPassword });
    } catch {
      if (!isCurrent()) return;
      locked.current = false;
      setReset({ status: 'error' });
    }
  }

  function closePassword() {
    setReset({ status: 'idle' });
    locked.current = false;
    // Restore focus after the reset buttons become enabled again.
    requestAnimationFrame(() => trigger.current?.focus());
  }

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
    <>
      <ul aria-label="用户列表">
        {state.accounts.map(({ id, username, createdAt, isAdmin }) => (
          <li key={id}>
            <span>{username}</span> <time dateTime={createdAt}>{createdAt}</time>{' '}
            {isAdmin && <span>管理员</span>}
            <button
              type="button"
              aria-label={`重置密码 ${username}`}
              disabled={reset.status === 'pending' || reset.status === 'secret'}
              onClick={(event) => {
                void resetPassword(id, username, event.currentTarget);
              }}
            >
              重置密码
            </button>
          </li>
        ))}
      </ul>
      {reset.status === 'pending' && <p role="status">正在重置密码</p>}
      {reset.status === 'error' && <p role="alert">无法重置密码，请重试</p>}
      {reset.status === 'secret' && (
        <TemporaryPassword password={reset.temporaryPassword} onClose={closePassword} />
      )}
    </>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { safeNextPath } from '../../shared/safe-next-path';

const ERROR_MESSAGES: Record<number, string> = {
  400: '请输入用户名和密码',
  401: '用户名或密码错误',
  409: '用户名已被占用',
};
const REQUEST_FAILED = '请求失败，请重试';

export function CredentialsForm({
  mode,
  next,
}: {
  mode: 'login' | 'register';
  next: string | null;
}) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = mode === 'login' ? '登录' : '注册';

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (response.ok) router.push(safeNextPath(next));
      else setError(ERROR_MESSAGES[response.status] ?? REQUEST_FAILED);
    } catch {
      setError(REQUEST_FAILED);
    } finally {
      setPending(false);
    }
  }

  return (
    <main data-testid={`${mode}-ready`}>
      <h1>{label}</h1>
      <form
        aria-label={label}
        method="post"
        action={`/api/auth/${mode}`}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          用户名
          <input
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
          />
        </label>
        <label>
          密码
          <input
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </label>
        <button type="submit" disabled={pending}>
          {label}
        </button>
        {pending && <p role="status">提交中…</p>}
        {error !== null && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}

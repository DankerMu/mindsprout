'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { safeNextPath } from '../../shared/safe-next-path';
import { useSessionNavigation } from './session-navigation';

const ERROR_MESSAGES: Record<number, string> = {
  400: '请输入用户名和密码',
  401: '用户名或密码错误',
  409: '用户名已被占用',
};
const REQUEST_FAILED = '请求失败，请重试';

export function CredentialsForm({
  mode,
  next,
  native = false,
}: {
  mode: 'login' | 'register';
  next: string | null;
  native?: boolean;
}) {
  const router = useRouter();
  const { publicAuthMounted, resumeAuthenticatedNavigation } = useSessionNavigation();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    publicAuthMounted();
    form.current?.setAttribute('data-hydrated', 'true');
  }, [publicAuthMounted]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>();
  const label = mode === 'login' ? '登录' : '注册';
  const otherPath = mode === 'login' ? '/register' : '/login';
  const destination = safeNextPath(next);
  const query = next === null ? '' : `?next=${encodeURIComponent(destination)}`;

  async function submit(credentials: FormData) {
    const username = credentials.get('username');
    const password = credentials.get('password');
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (response.ok) {
        resumeAuthenticatedNavigation();
        router.push(destination);
      } else {
        setError(ERROR_MESSAGES[response.status] ?? REQUEST_FAILED);
      }
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
        ref={form}
        aria-label={label}
        method="post"
        action={`/native-auth/${mode}${query}`}
        onSubmit={(event) => {
          event.preventDefault();
          const credentials = new FormData(event.currentTarget);
          void submit(credentials);
        }}
      >
        <label>
          用户名
          <input name="username" autoComplete="username" />
        </label>
        <label>
          密码
          <input
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        <button type="submit" disabled={pending}>
          {label}
        </button>
        {pending && <p role="status">提交中…</p>}
        <CredentialFeedback native={native} error={error} returnHref={`/${mode}${query}`} />
      </form>
      <p>
        {mode === 'login' ? '还没有账号？' : '已有账号？'}
        <Link href={`${otherPath}${query}`}>{mode === 'login' ? '注册' : '登录'}</Link>
      </p>
    </main>
  );
}

function CredentialFeedback({
  native,
  error,
  returnHref,
}: {
  native: boolean;
  error: string | null | undefined;
  returnHref: string;
}) {
  const nativeNotice = native && error === undefined;
  const message = nativeNotice ? '请启用 JavaScript 或等待页面加载后重试。' : error;
  return message ? (
    <>
      <p role="alert">{message}</p>
      {nativeNotice && <Link href={returnHref}>返回表单</Link>}
    </>
  ) : null;
}

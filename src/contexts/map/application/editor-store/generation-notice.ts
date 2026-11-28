import type { GenerateErrorCode } from '../../domain/errors';

// The single source of the editor's generation notices (design D9, spec topic-generation
// "Failure notices use fixed texts") and of the account-auth session-expiry notice, which the
// editor store re-exports for its autosave path.

export const SESSION_EXPIRED = '登录已过期，请在新标签页重新登录后继续编辑';

const FAILURE_TEXTS: Record<
  Exclude<GenerateErrorCode, 'ai-unavailable' | 'unauthenticated'>,
  string
> = {
  timeout: '生成超时，请重试',
  'provider-error': 'AI 服务出错，请稍后重试',
  'invalid-output': 'AI 返回的内容无法使用，请重试',
  refused: 'AI 拒绝了这个主题，请换一个主题',
  network: '网络连接失败，请检查网络后重试',
};

// `opsApplied` counts the source ops dispatched before the failure. `ai-unavailable` has no
// notice: its state is the store's aiUnavailable flag, and the form shows AI 未配置.
export function generationNotice(code: GenerateErrorCode, opsApplied: number): string | null {
  if (code === 'ai-unavailable') return null;
  if (code === 'unauthenticated') return SESSION_EXPIRED;
  return `${opsApplied === 0 ? '生成失败：' : '生成中断：'}${FAILURE_TEXTS[code]}`;
}

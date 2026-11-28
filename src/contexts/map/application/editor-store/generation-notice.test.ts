import { describe, expect, it } from 'vitest';
import type { GenerateErrorCode } from '../../domain/errors';
import { SESSION_EXPIRED as STORE_SESSION_EXPIRED } from './editor-store';
import { generationNotice, SESSION_EXPIRED } from './generation-notice';

// "Issue #308 Fixture Triage" and spec topic-generation "Failure notices use fixed texts": the
// expected strings are copied from the spec table, never from the module under test.

const FAILURES: [GenerateErrorCode, string][] = [
  ['timeout', '生成超时，请重试'],
  ['provider-error', 'AI 服务出错，请稍后重试'],
  ['invalid-output', 'AI 返回的内容无法使用，请重试'],
  ['refused', 'AI 拒绝了这个主题，请换一个主题'],
  ['network', '网络连接失败，请检查网络后重试'],
];

describe('generationNotice (spec "Failure notices use fixed texts")', () => {
  it.each(FAILURES)('%s with no op applied reads 生成失败：%s', (code, text) => {
    expect(generationNotice(code, 0)).toBe(`生成失败：${text}`);
  });

  it.each(FAILURES)('%s after ops were applied reads 生成中断：%s', (code, text) => {
    expect(generationNotice(code, 1)).toBe(`生成中断：${text}`);
    expect(generationNotice(code, 7)).toBe(`生成中断：${text}`);
  });

  it('unauthenticated gives the account-auth session-expiry notice whatever was applied', () => {
    expect(generationNotice('unauthenticated', 0)).toBe(
      '登录已过期，请在新标签页重新登录后继续编辑',
    );
    expect(generationNotice('unauthenticated', 3)).toBe(SESSION_EXPIRED);
  });

  it('ai-unavailable gives no notice (the form shows AI 未配置 instead)', () => {
    expect(generationNotice('ai-unavailable', 0)).toBeNull();
    expect(generationNotice('ai-unavailable', 2)).toBeNull();
  });
});

describe('SESSION_EXPIRED', () => {
  it('keeps its text and is the very constant the editor store re-exports', () => {
    expect(SESSION_EXPIRED).toBe('登录已过期，请在新标签页重新登录后继续编辑');
    expect(STORE_SESSION_EXPIRED).toBe(SESSION_EXPIRED);
  });
});

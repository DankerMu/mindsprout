import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE,
  SESSION_BINDING_COOKIE,
  SESSION_BINDING_HEADER,
  sessionBinding,
  readCookie,
} from './session-binding';

describe('session binding', () => {
  it('names the credential and non-secret account binding separately', () => {
    expect(SESSION_COOKIE).toBe('mindsprout_session');
    expect(SESSION_BINDING_COOKIE).toBe('mindsprout_session_binding');
    expect(SESSION_BINDING_HEADER).toBe('x-mindsprout-session-binding');
  });

  it.each([
    ['Alice', 'QWxpY2U'],
    [' Alice ', 'IEFsaWNlIA'],
    ['雪', '6Zuq'],
    ['😀', '8J-YgA'],
    ['é', 'w6k'],
    ['e\u0301', 'ZcyB'],
    ['', ''],
  ])('encodes the exact UTF-8 username %j without padding', (username, expected) => {
    expect(sessionBinding(username)).toBe(expected);
  });

  it.each([
    ['', undefined],
    ['mindsprout_session_binding', undefined],
    ['xmindsprout_session_binding=wrong; mindsprout_session_bindingx=wrong', undefined],
    [
      'mindsprout_session_binding=; mindsprout_session_binding=QWxpY2U; mindsprout_session_binding=Qm9i',
      'QWxpY2U',
    ],
    ['other=a=b; mindsprout_session_binding=opaque==', 'opaque=='],
    [' mindsprout_session_binding = %not-decoded ', ' %not-decoded '],
  ])('reads the first nonempty exact-name opaque cookie from %j', (cookies, expected) => {
    expect(readCookie(cookies, SESSION_BINDING_COOKIE)).toBe(expected);
  });
});

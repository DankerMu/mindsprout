export const SESSION_COOKIE = 'mindsprout_session';
export const SESSION_BINDING_COOKIE = 'mindsprout_session_binding';
export const SESSION_BINDING_HEADER = 'x-mindsprout-session-binding';

// Account identity only, never an authentication credential (decision 0028).
export function sessionBinding(username: string): string {
  const bytes = new TextEncoder().encode(username);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function readCookie(cookies: string, name: string): string | undefined {
  // First exact-name nonempty value wins; opaque values are never trimmed or decoded.
  for (const pair of cookies.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    const value = pair.slice(separator + 1);
    if (value !== '') return value;
  }
  return undefined;
}

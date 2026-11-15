export function safeNextPath(value: string | null): string {
  if (value !== null && /[\t\n\r]/.test(value)) return '/';
  return value?.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : '/';
}

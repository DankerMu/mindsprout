export function safeNextPath(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : '/';
}

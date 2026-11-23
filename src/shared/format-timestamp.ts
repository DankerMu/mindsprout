const timestampFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatTimestamp(isoTimestamp: string): string {
  return timestampFormatter.format(Date.parse(isoTimestamp));
}

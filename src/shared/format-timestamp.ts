const timestampFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : timestampFormatter.format(timestamp);
}

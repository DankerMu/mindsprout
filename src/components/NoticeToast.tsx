export function NoticeToast({
  notice,
  onDismiss,
}: {
  notice: string | null;
  onDismiss: () => void;
}) {
  if (notice === null) return null;
  return (
    <div role="alert">
      <span>{notice}</span>
      <button type="button" onClick={onDismiss} aria-label="关闭提示">
        关闭
      </button>
    </div>
  );
}

export function StorageUnavailableBanner({ storageUnavailable }: { storageUnavailable: boolean }) {
  return storageUnavailable ? <p role="status">未保存到浏览器</p> : null;
}

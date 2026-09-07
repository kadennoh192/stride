import { getLocalFile, cacheDownloadedFile, hashBlob } from './storage';
export async function fileURL(id: string, owner: string) {
  const local = await getLocalFile(id, owner);
  if (local) return URL.createObjectURL(local.blob);
  if (owner === 'guest')
    throw new Error(
      'This attachment is missing on this device. Restore it from a complete backup.',
    );
  const response = await fetch(`/api/files/${encodeURIComponent(id)}`, {
    headers: { 'X-Stride-Owner': owner },
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error(
      'This attachment has not downloaded yet. Reconnect and retry.',
    );
  const blob = await response.blob();
  const expected = response.headers.get('X-Content-SHA256');
  if (expected && expected !== (await hashBlob(blob)))
    throw new Error('Attachment integrity check failed. Please retry.');
  const saved = await cacheDownloadedFile(id, blob, owner);
  return URL.createObjectURL(saved.blob);
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

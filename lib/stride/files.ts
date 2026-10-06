import { generationHeaders } from './reset-generation';
import {
  acknowledgeFileDelete,
  cancelFileDelete,
  getLocalFile,
  cacheDownloadedFile,
  hashBlob,
  type FileDelete,
} from './storage';
export async function fileURL(id: string, owner: string) {
  const local = await getLocalFile(id, owner);
  if (local) return URL.createObjectURL(local.blob);
  if (owner === 'guest')
    throw new Error(
      'This attachment is missing on this device. Restore it from a complete backup.',
    );
  const response = await fetch(`/api/files/${encodeURIComponent(id)}`, {
    headers: { 'X-Stride-Owner': owner, ...generationHeaders },
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

export async function deleteRemoteFile(deletion: FileDelete) {
  const response = await fetch(
    `/api/files/${encodeURIComponent(deletion.id)}`,
    {
      method: 'DELETE',
      headers: { 'X-Stride-Owner': deletion.owner, ...generationHeaders },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (
    response.status === 409 &&
    response.headers.get('X-Stride-File-Deletion') === 'cancelled'
  ) {
    if (!(await cancelFileDelete(deletion)))
      throw new Error(
        'The attachment was restored elsewhere, but its local recovery copy is missing. Restore it from a backup.',
      );
    return;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      response.status === 401
        ? 'Sign in again to finish removing the attachment.'
        : response.status === 409 && detail === 'Account changed'
          ? 'The active account changed. Sign in to the attachment’s account to finish removing it.'
          : 'Attachment removal will retry when cloud sync is available.',
    );
  }
  await acknowledgeFileDelete(deletion);
}

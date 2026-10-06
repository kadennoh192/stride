import { generationHeaders } from './reset-generation';
import { acknowledgeFileTransfer, hashBlob, type LocalFile } from './storage';
import {
  UPLOAD_CHUNK_SIZE,
  contentHash,
  type UploadStatus,
} from './attachment-model';
async function responseJSON(
  response: Response,
): Promise<Record<string, unknown>> {
  let value: Record<string, unknown>;
  try {
    value = await response.json();
  } catch {
    throw new Error(
      'Attachment transfer is unavailable. It will resume on reconnect.',
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid attachment transfer response.');
  if (!response.ok)
    throw new Error(
      typeof value.error === 'string'
        ? value.error
        : 'Attachment upload will resume on reconnect.',
    );
  return value;
}
/** Reconcile with server acknowledgments before resuming any persisted local queue. */
export async function uploadFile(
  file: LocalFile,
  onProgress?: (confirmed: number, total: number) => void,
): Promise<void> {
  if (file.owner === 'guest')
    throw new Error('Sign in before uploading attachments.');
  const hash = await hashBlob(file.blob);
  if (file.hash && file.hash !== hash)
    throw new Error(
      'The local attachment failed its integrity check. Restore its original bytes from a backup.',
    );
  const url = `/api/files/${encodeURIComponent(file.id)}/upload`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Stride-Owner': file.owner,
    ...generationHeaders,
  };
  const status = (await responseJSON(
    await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'begin',
        hash,
        size: file.blob.size,
        name: file.name,
        type: file.blob.type,
      }),
      signal: AbortSignal.timeout(20000),
    }),
  )) as unknown as UploadStatus;
  const count = Math.ceil(file.blob.size / UPLOAD_CHUNK_SIZE);
  if (
    typeof status.complete !== 'boolean' ||
    status.chunkSize !== UPLOAD_CHUNK_SIZE ||
    !Array.isArray(status.parts) ||
    status.parts.some(
      (part) =>
        !part ||
        !Number.isSafeInteger(part.index) ||
        part.index < 0 ||
        part.index >= count ||
        typeof part.hash !== 'string' ||
        !contentHash.test(part.hash),
    )
  )
    throw new Error('Invalid attachment resume response. Nothing was removed.');
  const parts = new Set<number>();
  for (const part of status.parts)
    if (
      (await hashBlob(
        file.blob.slice(
          part.index * UPLOAD_CHUNK_SIZE,
          (part.index + 1) * UPLOAD_CHUNK_SIZE,
        ),
      )) === part.hash
    )
      parts.add(part.index);
  const acknowledgedBytes = () =>
    [...parts].reduce(
      (total, part) =>
        total +
        Math.min(UPLOAD_CHUNK_SIZE, file.blob.size - part * UPLOAD_CHUNK_SIZE),
      0,
    );
  const acknowledge = async (complete = false) => {
    const bytes = complete ? file.blob.size : acknowledgedBytes();
    if (!(await acknowledgeFileTransfer(file, hash, bytes, complete)))
      throw new Error(
        'This attachment changed during upload. The newer local version remains queued.',
      );
    onProgress?.(bytes, file.blob.size);
  };
  if (status.complete) {
    await acknowledge(true);
    return;
  }
  await acknowledge();
  for (let part = 0; part < count; part++) {
    if (parts.has(part)) continue;
    const chunk = file.blob.slice(
      part * UPLOAD_CHUNK_SIZE,
      (part + 1) * UPLOAD_CHUNK_SIZE,
    );
    await responseJSON(
      await fetch(`${url}?hash=${hash}&part=${part}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Content-SHA256': await hashBlob(chunk),
          'X-Stride-Owner': file.owner,
          ...generationHeaders,
        },
        body: chunk,
        signal: AbortSignal.timeout(30000),
      }),
    );
    parts.add(part);
    await acknowledge();
  }
  const completed = await responseJSON(
    await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'complete', hash }),
      signal: AbortSignal.timeout(30000),
    }),
  );
  if (completed.complete !== true)
    throw new Error(
      'Attachment completion was not confirmed. Saved parts will resume.',
    );
  await acknowledge(true);
}

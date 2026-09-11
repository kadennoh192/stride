import { bucket } from './bindings';
import {
  ATTACHMENT_LIMIT,
  UPLOAD_CHUNK_SIZE,
  type UploadManifest,
  type UploadRequest,
  type UploadStatus,
  contentHash,
} from '../stride/attachment-model';
export class UploadError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export async function readBounded(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length')) > limit)
    throw new UploadError('Upload request exceeds its size limit.', 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new UploadError('Upload request exceeds its size limit.', 413);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function sha256(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
const prefix = (owner: string, id: string, hash: string) =>
  `__stride_uploads/${owner}/${id}/${hash}/`;
async function manifest(
  owner: string,
  id: string,
  hash: string,
): Promise<UploadManifest> {
  const value = await bucket().get(prefix(owner, id, hash) + 'manifest');
  if (!value)
    throw new UploadError(
      'Upload session expired. Resume the upload to restart it.',
      409,
    );
  return value.json<UploadManifest>();
}
export async function beginUpload(
  owner: string,
  id: string,
  input: UploadRequest,
): Promise<UploadStatus> {
  await cleanExpiredUploads(owner);
  const files = bucket(),
    base = prefix(owner, id, input.hash);
  const existing = await files.head(`${owner}/${id}`);
  if (
    existing?.customMetadata?.sha256 === input.hash &&
    existing.size === input.size
  )
    return { complete: true, parts: [], chunkSize: UPLOAD_CHUNK_SIZE };
  const previous = await files.get(base + 'manifest');
  if (previous) {
    const meta = await previous.json<UploadManifest>();
    if (meta.size !== input.size)
      throw new UploadError(
        'Upload metadata conflicts with an existing session.',
        409,
      );
  } else
    await files.put(
      base + 'manifest',
      JSON.stringify({ ...input, created: Date.now() }),
      { onlyIf: { etagDoesNotMatch: '*' } },
    );
  const count = Math.ceil(input.size / UPLOAD_CHUNK_SIZE);
  const parts: UploadStatus['parts'] = [];
  await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const part = await files.head(base + index);
      if (
        part?.size ===
        Math.min(UPLOAD_CHUNK_SIZE, input.size - index * UPLOAD_CHUNK_SIZE)
      )
        if (
          part.customMetadata?.sha256 &&
          contentHash.test(part.customMetadata.sha256)
        )
          parts.push({ index, hash: part.customMetadata.sha256 });
    }),
  );
  return {
    complete: false,
    parts: parts.sort((a, b) => a.index - b.index),
    chunkSize: UPLOAD_CHUNK_SIZE,
  };
}
export async function uploadPart(
  owner: string,
  id: string,
  hash: string,
  index: number,
  bytes: Uint8Array,
  expectedHash: string,
) {
  const meta = await manifest(owner, id, hash);
  const expectedSize = Math.min(
    UPLOAD_CHUNK_SIZE,
    meta.size - index * UPLOAD_CHUNK_SIZE,
  );
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= Math.ceil(meta.size / UPLOAD_CHUNK_SIZE) ||
    bytes.length !== expectedSize
  )
    throw new UploadError('Invalid upload part or size.');
  if ((await sha256(bytes)) !== expectedHash)
    throw new UploadError('Attachment part integrity check failed.');
  await bucket().put(prefix(owner, id, hash) + index, bytes, {
    customMetadata: { sha256: expectedHash },
  });
}
export async function completeUpload(owner: string, id: string, hash: string) {
  const files = bucket(),
    existing = await files.head(`${owner}/${id}`);
  if (existing?.customMetadata?.sha256 === hash) return;
  const meta = await manifest(owner, id, hash),
    base = prefix(owner, id, hash);
  if (meta.size > ATTACHMENT_LIMIT)
    throw new UploadError('Attachment exceeds the supported size.', 413);
  const bytes = new Uint8Array(meta.size),
    keys: string[] = [];
  for (
    let index = 0;
    index < Math.ceil(meta.size / UPLOAD_CHUNK_SIZE);
    index++
  ) {
    const key = base + index,
      part = await files.get(key);
    if (!part)
      throw new UploadError(
        'Upload is incomplete. Resume the missing parts.',
        409,
      );
    const chunk = new Uint8Array(await part.arrayBuffer());
    if (
      chunk.length !==
        Math.min(UPLOAD_CHUNK_SIZE, meta.size - index * UPLOAD_CHUNK_SIZE) ||
      (await sha256(chunk)) !== part.customMetadata?.sha256
    ) {
      await files.delete(key);
      throw new UploadError(
        'Stored upload part failed its integrity check. Resume to repair it.',
        409,
      );
    }
    bytes.set(chunk, index * UPLOAD_CHUNK_SIZE);
    keys.push(key);
  }
  if ((await sha256(bytes)) !== hash)
    throw new UploadError('Complete attachment integrity check failed.', 409);
  await files.put(`${owner}/${id}`, bytes, {
    customMetadata: { sha256: hash, name: meta.name },
    httpMetadata: { contentType: meta.type || 'application/octet-stream' },
  });
  // Cleanup is best-effort after durable finalization; retries recognize the completed object.
  try {
    await files.delete([...keys, base + 'manifest']);
  } catch {
    /* Verified bytes are already durable. */
  }
}

/** Advance bounded cleanup over expired temporary chunks; durable attachment objects are outside this prefix. */
async function cleanExpiredUploads(owner: string) {
  const files = bucket(),
    scanPrefix = `__stride_uploads/${owner}/`,
    marker = `__stride_upload_gc/${owner}`;
  try {
    const saved = await files.get(marker);
    const cursor = saved ? await saved.text() : '';
    const page = await files.list({
      prefix: scanPrefix,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    const cutoff = Date.now() - 7 * 86400000;
    const expired = page.objects
      .filter(
        (object) =>
          object.key.startsWith(scanPrefix) &&
          object.uploaded.getTime() < cutoff,
      )
      .map((object) => object.key);
    if (expired.length) await files.delete(expired);
    await files.put(marker, page.truncated ? page.cursor : '');
  } catch {
    // Reset a failed cursor so later cleanup can make progress, without touching durable files.
    try {
      await files.delete(marker);
    } catch {
      /* Maintenance never blocks transfer. */
    }
  }
}

export const ATTACHMENT_LIMIT = 10_000_000;
export const UPLOAD_CHUNK_SIZE = 1_000_000;
export const attachmentId = /^[a-zA-Z0-9_-]{1,100}$/;
export const contentHash = /^[a-f0-9]{64}$/;
export interface UploadRequest {
  hash: string;
  size: number;
  type: string;
  name: string;
}
export interface UploadManifest extends UploadRequest {
  created: number;
}
export interface UploadStatus {
  complete: boolean;
  parts: { index: number; hash: string }[];
  chunkSize: number;
}
export function validUploadRequest(value: unknown): value is UploadRequest {
  if (!value || typeof value !== 'object') return false;
  const m = value as UploadManifest;
  return (
    typeof m.hash === 'string' &&
    contentHash.test(m.hash) &&
    Number.isSafeInteger(m.size) &&
    m.size >= 0 &&
    m.size <= ATTACHMENT_LIMIT &&
    typeof m.type === 'string' &&
    m.type.length <= 255 &&
    !/[\r\n]/.test(m.type) &&
    typeof m.name === 'string' &&
    m.name.length <= 1024
  );
}

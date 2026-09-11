import {
  type Snapshot,
  type LocalFile,
  captureWorkspace,
  getLocalFile,
  hashBlob,
  materialize,
  restoreSnapshot,
} from './storage';
import {
  validField,
  validChange,
  validConflict,
  validateEntity,
  validateGraph,
} from './validation';
import { fileURL } from './files';
interface BackupFile {
  id: string;
  name: string;
  type: string;
  hash: string;
  bytes: string;
}
export interface Backup {
  format: 'stride';
  version: 2;
  created: string;
  snapshot: Snapshot;
  files: BackupFile[];
}
export interface StagedBackup {
  backup: Backup;
  files: LocalFile[];
  records: number;
  bytes: number;
}
const MAX_BYTES = 150_000_000;
export function encodeBytes(bytes: Uint8Array) {
  let raw = '';
  for (let i = 0; i < bytes.length; i += 8192)
    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeBytes(value: string) {
  if (!/^[A-Za-z0-9_-]*$/.test(value))
    throw new Error('Invalid export encoding');
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function digest(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
async function bounded(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new Error('Backup exceeds the 150 MB restore limit.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
function fileIds(snapshot: Snapshot) {
  const ids = new Set<string>();
  for (const e of materialize(snapshot.fields, true)) {
    if (e.kind === 'block' && typeof e.data.file === 'string' && e.data.file)
      ids.add(e.data.file);
    if (e.kind === 'row') {
      for (const value of Object.values({
        ...e.data,
        ...(e.data.values as Record<string, unknown>),
      })) {
        if (Array.isArray(value))
          for (const file of value)
            if (
              file &&
              typeof file === 'object' &&
              typeof file.id === 'string' &&
              typeof file.name === 'string'
            )
              ids.add(file.id);
      }
    }
  }
  return ids;
}
export async function exportBackup(
  owner: string,
): Promise<{ json: string; code: string }> {
  const { snapshot, files: local } = await captureWorkspace(owner);
  for (const id of fileIds(snapshot))
    if (!local.some((f) => f.id === id)) {
      const url = await fileURL(id, owner);
      URL.revokeObjectURL(url);
      const downloaded = await getLocalFile(id, owner);
      if (!downloaded)
        throw new Error('An attachment could not be captured. Please retry.');
      local.push(downloaded);
    }
  if (local.reduce((sum, f) => sum + f.blob.size, 0) > 100_000_000)
    throw new Error(
      'Attachments exceed this release’s 100 MB export limit. Export smaller workspaces separately; nothing has been removed.',
    );
  const files: BackupFile[] = [];
  for (const f of local)
    files.push({
      id: f.id,
      name: f.name,
      type: f.blob.type,
      hash: await hashBlob(f.blob),
      bytes: encodeBytes(new Uint8Array(await f.blob.arrayBuffer())),
    });
  const backup: Backup = {
    format: 'stride',
    version: 2,
    created: new Date().toISOString(),
    snapshot: {
      ...snapshot,
      owner: 'guest',
      outbox: [],
      cursor: 0,
      device: 'backup',
      lastSync: '',
    },
    files,
  };
  const json = JSON.stringify(backup);
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > MAX_BYTES)
    throw new Error('Workspace exceeds the 150 MB export limit.');
  if (typeof CompressionStream === 'undefined') return { json, code: '' };
  const compressed = await bounded(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
    MAX_BYTES,
  );
  return {
    json,
    code: `STRIDE2.${await digest(compressed)}.${encodeBytes(compressed)}`,
  };
}
export async function stageBackup(input: string): Promise<StagedBackup> {
  let json = input.trim();
  if (json.length > MAX_BYTES * 1.5) throw new Error('Backup is too large');
  if (json.startsWith('STRIDE')) {
    const parts = json.split('.');
    if (parts.length !== 3 || parts[0] !== 'STRIDE2')
      throw new Error(
        'Unsupported Stride export version. Use a newer version of Stride.',
      );
    const compressed = decodeBytes(parts[2]);
    if ((await digest(compressed)) !== parts[1])
      throw new Error(
        'Export checksum mismatch. Copy the entire code or use the downloaded backup.',
      );
    if (typeof DecompressionStream === 'undefined')
      throw new Error(
        'Compressed restore is unavailable in this browser. Use JSON import.',
      );
    json = new TextDecoder('utf-8', { fatal: true }).decode(
      await bounded(
        new Blob([compressed])
          .stream()
          .pipeThrough(new DecompressionStream('gzip')),
        MAX_BYTES,
      ),
    );
  }
  let backup: Backup;
  try {
    backup = JSON.parse(json);
  } catch {
    throw new Error('This is not a valid Stride backup.');
  }
  if (
    !backup ||
    backup.format !== 'stride' ||
    backup.version !== 2 ||
    !backup.snapshot ||
    backup.snapshot.version !== 2 ||
    !Array.isArray(backup.files) ||
    !Array.isArray(backup.snapshot.history) ||
    !Array.isArray(backup.snapshot.conflicts)
  )
    throw new Error('Unsupported or incomplete backup');
  if (
    !backup.snapshot.fields ||
    Object.values(backup.snapshot.fields).some((f) => !validField(f)) ||
    !backup.snapshot.history.every(validChange) ||
    !backup.snapshot.conflicts.every(validConflict)
  )
    throw new Error('Backup contains invalid records');
  for (const [key, f] of Object.entries(backup.snapshot.fields))
    if (key !== `${f.entity}:${f.key}`) throw new Error('Invalid record key');
  const records = materialize(backup.snapshot.fields, true);
  records.forEach(validateEntity);
  const byId = new Map(records.map((e) => [e.id, e]));
  validateGraph(records, (id) => byId.get(id));
  const files: LocalFile[] = [];
  const ids = new Set<string>();
  let bytes = 0;
  for (const f of backup.files) {
    if (
      !/^[a-zA-Z0-9-]{1,150}$/.test(f.id) ||
      ids.has(f.id) ||
      typeof f.name !== 'string' ||
      typeof f.type !== 'string' ||
      typeof f.bytes !== 'string'
    )
      throw new Error('Invalid attachment metadata');
    ids.add(f.id);
    const raw = decodeBytes(f.bytes);
    bytes += raw.length;
    if (raw.length > 10_000_000 || bytes > 100_000_000)
      throw new Error('Attachment size limit exceeded');
    const blob = new Blob([raw], { type: f.type });
    if ((await hashBlob(blob)) !== f.hash)
      throw new Error(`Attachment integrity check failed: ${f.name}`);
    files.push({
      id: f.id,
      name: f.name,
      hash: f.hash,
      blob,
      uploaded: false,
      owner: 'guest',
    });
  }
  for (const id of fileIds(backup.snapshot))
    if (!ids.has(id))
      throw new Error('Backup is incomplete: an attachment is missing');
  return {
    backup,
    files,
    records: records.filter((e) => !e.deleted).length,
    bytes,
  };
}
export async function restoreBackup(staged: StagedBackup, owner: string) {
  await restoreSnapshot(staged.backup.snapshot, staged.files, owner);
}

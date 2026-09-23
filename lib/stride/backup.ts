import { attachmentReferences } from './attachment-references';
import { attachmentId, contentHash } from './attachment-model';
import {
  SNAPSHOT_VERSION,
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
interface ArchiveFile extends Omit<BackupFile, 'bytes'> {
  size: number;
}
interface BackupArchive {
  format: 'stride-archive';
  version: 4;
  created: string;
  snapshot: Snapshot;
  files: ArchiveFile[];
}
export interface Backup {
  format: 'stride';
  version: 3;
  created: string;
  snapshot: Snapshot;
  files: BackupFile[];
}
export interface StagedBackup {
  backup: Pick<Backup, 'created' | 'snapshot'>;
  files: LocalFile[];
  records: number;
  bytes: number;
}
const MAX_BYTES = 150_000_000;
const LEGACY_ATTACHMENT_LIMIT = 100_000_000;
const FILE_LIMIT = 10_000_000;
const ARCHIVE_MAGIC = 'STRIDE4\n';
const PREVIOUS_ARCHIVE_MAGIC = 'STRIDE3\n';
const ARCHIVE_PREFIX_BYTES = 76;
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
async function captureComplete(owner: string) {
  const { snapshot, files: local } = await captureWorkspace(owner);
  const references = attachmentReferences(snapshot);
  for (const id of references)
    if (!local.some((f) => f.id === id)) {
      const url = await fileURL(id, owner);
      URL.revokeObjectURL(url);
      const downloaded = await getLocalFile(id, owner);
      if (!downloaded)
        throw new Error('An attachment could not be captured. Please retry.');
      local.push(downloaded);
    }
  return {
    snapshot: {
      ...snapshot,
      owner: 'guest',
      outbox: [],
      cursor: 0,
      device: 'backup',
      lastSync: '',
    },
    // Bytes awaiting permanent cloud cleanup are deliberately not recoverable
    // through backups made after their synced tombstone was written.
    files: local.filter((file) => references.has(file.id)),
    created: new Date().toISOString(),
  };
}
async function legacyExport(
  snapshot: Snapshot,
  local: LocalFile[],
  created: string,
): Promise<{ json: string; code: string }> {
  if (
    local.reduce((sum, file) => sum + file.blob.size, 0) >
    LEGACY_ATTACHMENT_LIMIT
  )
    throw new Error(
      'Attachments exceed this preview’s 100 MB export limit. Nothing has been removed.',
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
    version: 3,
    created,
    snapshot,
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
    code: `STRIDE3.${await digest(compressed)}.${encodeBytes(compressed)}`,
  };
}
export async function exportBackup(
  owner: string,
): Promise<{ json: string; code: string }> {
  const { snapshot, files, created } = await captureComplete(owner);
  return legacyExport(snapshot, files, created);
}

/** Stream-friendly backup container: metadata is bounded, attachment Blobs are not base64-expanded. */
export async function exportBackupArchive(
  owner: string,
): Promise<{ blob: Blob; code: string }> {
  const { snapshot, files, created } = await captureComplete(owner);
  const metadata: ArchiveFile[] = [];
  for (const file of files)
    metadata.push({
      id: file.id,
      name: file.name,
      type: file.blob.type,
      hash: await hashBlob(file.blob),
      size: file.blob.size,
    });
  const header = new TextEncoder().encode(
    JSON.stringify({
      format: 'stride-archive',
      version: 4,
      created,
      snapshot,
      files: metadata,
    } satisfies BackupArchive),
  );
  if (header.byteLength > MAX_BYTES)
    throw new Error('Workspace metadata exceeds the 150 MB backup limit.');
  const prefix = new Uint8Array(ARCHIVE_PREFIX_BYTES);
  prefix.set(new TextEncoder().encode(ARCHIVE_MAGIC));
  new DataView(prefix.buffer).setUint32(8, header.byteLength, false);
  prefix.set(new TextEncoder().encode(await digest(header)), 12);
  let code = '';
  if (
    files.reduce((sum, file) => sum + file.blob.size, 0) <=
    LEGACY_ATTACHMENT_LIMIT
  )
    try {
      code = (await legacyExport(snapshot, files, created)).code;
    } catch (error) {
      if (!String(error).includes('150 MB export limit')) throw error;
    }
  return {
    blob: new Blob([prefix, header, ...files.map((file) => file.blob)], {
      type: 'application/vnd.stride.backup',
    }),
    code,
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function validateEnvelope(value: unknown) {
  if (!record(value) || !record(value.snapshot))
    throw new Error('Unsupported or incomplete backup');
  const snapshot = value.snapshot as unknown as Snapshot;
  if (
    typeof value.created !== 'string' ||
    !Number.isFinite(Date.parse(value.created)) ||
    ![2, SNAPSHOT_VERSION].includes(snapshot.version) ||
    !record(snapshot.fields) ||
    !Array.isArray(snapshot.history) ||
    !Array.isArray(snapshot.outbox) ||
    !Array.isArray(snapshot.conflicts) ||
    !Number.isSafeInteger(snapshot.clock) ||
    snapshot.clock < 0 ||
    !Number.isSafeInteger(snapshot.cursor) ||
    snapshot.cursor < 0 ||
    typeof snapshot.device !== 'string' ||
    snapshot.device.length > 150 ||
    typeof snapshot.owner !== 'string' ||
    snapshot.owner.length > 150 ||
    typeof snapshot.initialized !== 'boolean' ||
    typeof snapshot.lastSync !== 'string' ||
    (snapshot.lastSync !== '' &&
      !Number.isFinite(Date.parse(snapshot.lastSync)))
  )
    throw new Error('Unsupported or incomplete backup');
  if (
    Object.values(snapshot.fields).some((field) => !validField(field)) ||
    !snapshot.history.every(validChange) ||
    !snapshot.outbox.every(validChange) ||
    !snapshot.conflicts.every(validConflict)
  )
    throw new Error('Backup contains invalid records');
  for (const [key, field] of Object.entries(snapshot.fields))
    if (key !== `${field.entity}:${field.key}`)
      throw new Error('Invalid record key');
  const entityKinds = new Map<string, string>();
  const checkKind = (field: import('./types').Field) => {
    const previous = entityKinds.get(field.entity);
    if (previous && previous !== field.kind)
      throw new Error('A backup record changes its entity type.');
    entityKinds.set(field.entity, field.kind);
  };
  Object.values(snapshot.fields).forEach(checkKind);
  for (const change of [...snapshot.history, ...snapshot.outbox])
    change.fields.forEach(checkKind);
  for (const conflict of snapshot.conflicts) {
    checkKind(conflict.local);
    checkKind(conflict.remote);
  }
  const materialized = materialize(snapshot.fields, true);
  materialized.forEach(validateEntity);
  const byId = new Map(materialized.map((entity) => [entity.id, entity]));
  validateGraph(materialized, (id) => byId.get(id));
  return {
    backup: { created: value.created, snapshot },
    records: materialized.filter((entity) => !entity.deleted).length,
    references: attachmentReferences(snapshot),
  };
}
function validFileMetadata(
  value: unknown,
  ids: Set<string>,
): value is Record<string, unknown> & Omit<BackupFile, 'bytes'> {
  if (!record(value)) return false;
  return (
    typeof value.id === 'string' &&
    attachmentId.test(value.id) &&
    !ids.has(value.id) &&
    typeof value.name === 'string' &&
    value.name.length <= 1024 &&
    typeof value.hash === 'string' &&
    contentHash.test(value.hash) &&
    typeof value.type === 'string' &&
    value.type.length <= 255 &&
    !/[\r\n]/.test(value.type)
  );
}
export async function stageBackup(input: string): Promise<StagedBackup> {
  let json = input.trim();
  if (json.length > MAX_BYTES * 1.5) throw new Error('Backup is too large');
  if (json.startsWith('STRIDE')) {
    const parts = json.split('.');
    if (parts.length !== 3 || !['STRIDE2', 'STRIDE3'].includes(parts[0]))
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
  if (new TextEncoder().encode(json).byteLength > MAX_BYTES)
    throw new Error('Backup exceeds the 150 MB restore limit.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('This is not a valid Stride backup.');
  }
  if (
    !record(parsed) ||
    !Array.isArray(parsed.files) ||
    parsed.format !== 'stride' ||
    ![2, 3].includes(Number(parsed.version))
  )
    throw new Error('Unsupported or incomplete backup');
  const validated = validateEnvelope(parsed);
  const files: LocalFile[] = [];
  const ids = new Set<string>();
  let bytes = 0;
  for (const f of parsed.files) {
    if (!validFileMetadata(f, ids) || typeof f.bytes !== 'string')
      throw new Error('Invalid attachment metadata');
    ids.add(f.id);
    const raw = decodeBytes(f.bytes);
    bytes += raw.length;
    if (raw.length > FILE_LIMIT || bytes > LEGACY_ATTACHMENT_LIMIT)
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
  for (const id of validated.references)
    if (!ids.has(id))
      throw new Error('Backup is incomplete: an attachment is missing');
  return {
    backup: validated.backup,
    files,
    records: validated.records,
    bytes,
  };
}
export async function stageBackupFile(input: Blob): Promise<StagedBackup> {
  const prefix = new Uint8Array(
    await input.slice(0, ARCHIVE_PREFIX_BYTES).arrayBuffer(),
  );
  const magic = new TextDecoder().decode(prefix.subarray(0, 8));
  if (magic !== ARCHIVE_MAGIC && magic !== PREVIOUS_ARCHIVE_MAGIC) {
    if (input.size > MAX_BYTES)
      throw new Error(
        'Large backups must use the current .stride archive format.',
      );
    return stageBackup(await input.text());
  }
  if (prefix.byteLength !== ARCHIVE_PREFIX_BYTES)
    throw new Error('This Stride backup is incomplete.');
  const headerLength = new DataView(
    prefix.buffer,
    prefix.byteOffset,
    prefix.byteLength,
  ).getUint32(8, false);
  if (!headerLength || headerLength > MAX_BYTES)
    throw new Error('Invalid Stride backup header.');
  const headerEnd = ARCHIVE_PREFIX_BYTES + headerLength;
  if (headerEnd > input.size)
    throw new Error('This Stride backup is incomplete.');
  const headerBytes = new Uint8Array(
    await input.slice(ARCHIVE_PREFIX_BYTES, headerEnd).arrayBuffer(),
  );
  const expectedHeaderHash = new TextDecoder().decode(prefix.subarray(12));
  if (
    !contentHash.test(expectedHeaderHash) ||
    (await digest(headerBytes)) !== expectedHeaderHash
  )
    throw new Error('Backup header checksum mismatch.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(headerBytes),
    );
  } catch {
    throw new Error('This is not a valid Stride backup.');
  }
  if (
    !record(parsed) ||
    parsed.format !== 'stride-archive' ||
    ![3, 4].includes(Number(parsed.version)) ||
    !Array.isArray(parsed.files)
  )
    throw new Error('Unsupported or incomplete backup');
  const validated = validateEnvelope(parsed);
  const files: LocalFile[] = [];
  const ids = new Set<string>();
  let offset = headerEnd;
  for (const value of parsed.files) {
    if (
      !validFileMetadata(value, ids) ||
      typeof value.size !== 'number' ||
      !Number.isSafeInteger(value.size) ||
      value.size < 0 ||
      value.size > FILE_LIMIT ||
      offset + value.size > input.size
    )
      throw new Error('Invalid attachment metadata');
    ids.add(value.id);
    const blob = input.slice(offset, offset + value.size, value.type);
    offset += value.size;
    if ((await hashBlob(blob)) !== value.hash)
      throw new Error(`Attachment integrity check failed: ${value.name}`);
    files.push({
      id: value.id,
      name: value.name,
      hash: value.hash,
      blob,
      uploaded: false,
      owner: 'guest',
    });
  }
  if (offset !== input.size)
    throw new Error('Backup contains unexpected trailing data.');
  for (const id of validated.references)
    if (!ids.has(id))
      throw new Error('Backup is incomplete: an attachment is missing');
  return {
    backup: validated.backup,
    files,
    records: validated.records,
    bytes: files.reduce((sum, file) => sum + file.blob.size, 0),
  };
}
export async function restoreBackup(staged: StagedBackup, owner: string) {
  await restoreSnapshot(staged.backup.snapshot, staged.files, owner);
}

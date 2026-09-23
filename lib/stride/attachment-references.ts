import type { Field } from './types';
import type { Snapshot } from './storage';
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function collectAttachmentReferences(
  snapshot: Snapshot,
  includeRecoverable: boolean,
): Set<string> {
  const ids = new Set<string>();
  const file = (value: unknown) => {
    if (typeof value === 'string' && value) ids.add(value);
  };
  const fileList = (value: unknown) => {
    if (Array.isArray(value))
      for (const item of value)
        if (record(item) && typeof item.name === 'string' && !('kind' in item))
          file(item.id);
  };
  const row = (value: unknown) => {
    if (!record(value)) return;
    for (const [key, cell] of Object.entries(value)) {
      if (key.startsWith('cell_')) fileList(cell);
      if (key === 'values' && record(cell))
        for (const legacyCell of Object.values(cell)) fileList(legacyCell);
    }
  };
  const visit = (field: Field) => {
    if (field.kind === 'block' && field.key === 'file') file(field.value);
    else if (field.kind === 'row') row({ [field.key]: field.value });
    else if (field.kind === 'assignment' && field.key === 'attachments')
      fileList(field.value);
    else if (field.kind === 'template') {
      if (field.key === 'row') row(field.value);
      else if (field.key === 'blocks' && Array.isArray(field.value))
        for (const block of field.value) if (record(block)) file(block.file);
    }
  };
  Object.values(snapshot.fields).forEach(visit);
  if (includeRecoverable) {
    for (const change of [...snapshot.history, ...snapshot.outbox])
      change.fields.forEach(visit);
    for (const conflict of snapshot.conflicts) {
      visit(conflict.local);
      visit(conflict.remote);
    }
  }
  return ids;
}

/** All recoverable versions need bytes, including deleted records and saved templates. */
export function attachmentReferences(snapshot: Snapshot): Set<string> {
  const ids = collectAttachmentReferences(snapshot, true);
  for (const field of Object.values(snapshot.fields))
    if (
      field.kind === 'fileTombstone' &&
      field.key === 'attachment' &&
      typeof field.value === 'string'
    )
      ids.delete(field.value);
  return ids;
}

/** Current references only, used to prevent removing bytes shared by another record. */
export function currentAttachmentReferences(
  snapshot: Snapshot,
  ignoredFieldKey = '',
): Set<string> {
  const current = structuredClone(snapshot);
  if (ignoredFieldKey) delete current.fields[ignoredFieldKey];
  return collectAttachmentReferences(current, false);
}

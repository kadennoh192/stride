import { noteData, noteText, documentAttachments } from '../lib/stride/notes';
import type { NoteDocument } from '../lib/stride/types';
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blank,
  applyEdits,
  materialize,
  mergeFields,
  load,
  transact,
  saveFile,
  getLocalFile,
  listRecovery,
  restoreSnapshot,
  startupProjection,
  searchRecords,
} from '../lib/stride/storage';
import { dateKey, defaults, taskData, uid } from '../lib/stride/types';
import {
  exportBackup,
  exportBackupArchive,
  stageBackup,
  stageBackupFile,
  restoreBackup,
} from '../lib/stride/backup';
void test('edits and their outbox records commit together and remain account-isolated', async () => {
  const id = uid();
  await transact((s) => {
    applyEdits(
      s,
      [{ id, kind: 'task', data: taskData('Persistent') }],
      'Create',
    );
  }, 'alice');
  const saved = await load('alice');
  assert.equal(materialize(saved.fields)[0].data.title, 'Persistent');
  assert.equal(saved.outbox.length, 1);
  assert.equal(materialize((await load('bob')).fields).length, 0);
  await assert.rejects(
    transact((s) => {
      applyEdits(s, [{ id, kind: 'task', data: { title: '' } }], 'Invalid');
    }, 'alice'),
  );
  assert.equal(
    materialize((await load('alice')).fields)[0].data.title,
    'Persistent',
  );
});
void test('disjoint fields merge and same-field alternatives are retained', () => {
  const original = blank();
  const id = uid();
  applyEdits(
    original,
    [{ id, kind: 'task', data: taskData('Original') }],
    'Create',
  );
  const left = structuredClone(original),
    right = structuredClone(original);
  left.device = 'device-a';
  right.device = 'device-b';
  applyEdits(left, [{ id, kind: 'task', data: { title: 'Left' } }], 'Edit');
  applyEdits(
    right,
    [{ id, kind: 'task', data: { description: 'Right description' } }],
    'Edit',
  );
  mergeFields(left, right.outbox.at(-1)!.fields);
  assert.equal(left.conflicts.length, 0);
  assert.equal(
    materialize(left.fields)[0].data.description,
    'Right description',
  );
  applyEdits(right, [{ id, kind: 'task', data: { title: 'Right' } }], 'Edit');
  mergeFields(left, right.outbox.at(-1)!.fields);
  assert.equal(left.conflicts.length, 1);
  assert.equal(left.conflicts[0].local.value, 'Left');
  assert.equal(left.conflicts[0].remote.value, 'Right');
  mergeFields(left, right.outbox.at(-1)!.fields);
  assert.equal(left.conflicts.length, 1);
});
void test('large operations never split a new entity across sync chunks', () => {
  const state = blank();
  applyEdits(
    state,
    Array.from({ length: 90 }, (_, i) => ({
      id: `task-${i}`,
      kind: 'task' as const,
      data: taskData(`Task ${i}`),
    })),
    'Bulk',
  );
  assert.ok(state.outbox.length > 1);
  for (const change of state.outbox) {
    const records = materialize(
      Object.fromEntries(change.fields.map((f) => [`${f.entity}:${f.key}`, f])),
    );
    for (const e of records) {
      assert.equal(
        e.data.timezone,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      assert.equal(e.data.status, 'To do');
    }
  }
});
void test('complete backups round-trip records and bytes; corruption is rejected', async () => {
  const owner = 'backup-source';
  const fileId = uid();
  const pageId = uid();
  await saveFile(
    fileId,
    new Blob(['original attachment'], { type: 'text/plain' }),
    owner,
    'note.txt',
  );
  await transact(
    (s) =>
      applyEdits(
        s,
        [
          {
            id: pageId,
            kind: 'note',
            data: noteData('', 'A page'),
          },
          {
            id: uid(),
            kind: 'note',
            data: attachmentNoteData(fileId, 'note.txt'),
          },
        ],
        'Setup',
      ),
    owner,
  );
  const exported = await exportBackup(owner);
  const staged = await stageBackup(exported.code);
  assert.equal(staged.files.length, 1);
  await restoreBackup(staged, 'backup-target');
  assert.equal(materialize((await load('backup-target')).fields).length, 2);
  assert.equal(
    await (await getLocalFile(fileId, 'backup-target'))?.blob.text(),
    'original attachment',
  );
  await assert.rejects(stageBackup(exported.code.slice(0, -10) + 'aaaaaaaaaa'));
  const parsed = JSON.parse(exported.json);
  parsed.files = [];
  await assert.rejects(stageBackup(JSON.stringify(parsed)), /missing/);
  parsed.version = 99;
  await assert.rejects(stageBackup(JSON.stringify(parsed)), /incompatible/);
  const archive = await exportBackupArchive(owner);
  const archived = await stageBackupFile(archive.blob);
  assert.equal(archived.records, 2);
  assert.equal(await archived.files[0].blob.text(), 'original attachment');
  assert.ok(archive.code.startsWith('STRIDE5.'));
  assert.equal((await stageBackupFile(new Blob([exported.json]))).records, 2);
  const corrupted = new Uint8Array(await archive.blob.arrayBuffer());
  corrupted[80] ^= 1;
  await assert.rejects(
    stageBackupFile(new Blob([corrupted])),
    /header checksum/,
  );
  await assert.rejects(
    stageBackupFile(archive.blob.slice(0, -1)),
    /metadata|incomplete/,
  );
});
void test('restore preserves original record and file bytes in recovery', async () => {
  const owner = 'recover';
  const id = uid(),
    fileId = uid();
  await transact(
    (s) =>
      applyEdits(
        s,
        [
          {
            id,
            kind: 'note',
            data: noteData('', 'Before'),
          },
        ],
        'Before',
      ),
    owner,
  );
  await saveFile(fileId, new Blob(['before']), owner, 'before.txt');
  const replacement = blank();
  applyEdits(
    replacement,
    [
      {
        id,
        kind: 'note',
        data: noteData('', 'After'),
      },
    ],
    'After',
  );
  await restoreSnapshot(
    replacement,
    [
      {
        id: fileId,
        owner,
        blob: new Blob(['after']),
        hash: '',
        name: 'after.txt',
        uploaded: false,
      },
    ],
    owner,
  );
  const recovery = (await listRecovery(owner))[0];
  assert.equal(materialize(recovery.snapshot.fields)[0].data.title, 'Before');
  assert.equal(await recovery.files[0].blob.text(), 'before');
  assert.equal(materialize((await load(owner)).fields)[0].data.title, 'After');
  await restoreSnapshot(recovery.snapshot, recovery.files, owner);
  assert.equal(
    await (await getLocalFile(fileId, owner))?.blob.text(),
    'before',
  );
});

void test('restart preserves causal outbox order, acknowledgments, and indexed records', async () => {
  const { closeStorage, indexedRecords } =
    await import('../lib/stride/storage');
  const owner = 'restart';
  const id = uid();
  await transact((s) => {
    applyEdits(
      s,
      [
        {
          id,
          kind: 'task',
          data: taskData('Create', { project: 'project-a' }),
        },
      ],
      'Create',
    );
  }, owner);
  await transact((s) => {
    applyEdits(s, [{ id, kind: 'task', data: { title: 'Edit' } }], 'Edit');
  }, owner);
  const before = await load(owner);
  const ids = before.outbox.map((c) => c.id);
  await closeStorage();
  const reopened = await load(owner);
  assert.deepEqual(
    reopened.outbox.map((c) => c.id),
    ids,
  );
  assert.deepEqual(
    reopened.history.map((c) => c.label),
    ['Create', 'Edit'],
  );
  assert.equal(
    (await indexedRecords(owner, 'task', 'project-a'))[0].data.title,
    'Edit',
  );
  await transact((s) => {
    s.outbox = s.outbox.filter((c) => c.id !== ids[0]);
  }, owner);
  await closeStorage();
  assert.deepEqual(
    (await load(owner)).outbox.map((c) => c.id),
    [ids[1]],
  );
});

void test('keyset record pages skip tombstones without scanning prior records', async () => {
  const { indexedRecordPage } = await import('../lib/stride/storage');
  const owner = 'keyset-pages';
  await transact((state) => {
    applyEdits(
      state,
      ['a', 'b', 'c', 'd', 'e'].map((suffix) => ({
        id: `task-${suffix}`,
        kind: 'task' as const,
        data: taskData(`Task ${suffix}`, { project: 'project-a' }),
      })),
      'Create page fixture',
    );
    applyEdits(
      state,
      [{ id: 'task-b', kind: 'task', data: { _deleted: true } }],
      'Delete fixture record',
    );
  }, owner);
  assert.deepEqual(
    (await indexedRecordPage(owner, 'task', 'project-a', 2, 'task-a')).map(
      (record) => record.id,
    ),
    ['task-c', 'task-d'],
  );
});

void test('startup projection is bounded, route-aware, and owner-isolated', async () => {
  const owner = 'startup-projection';
  await transact((state) => {
    applyEdits(
      state,
      [
        ...Array.from({ length: 105 }, (_, index) => ({
          id: `undated-${String(index).padStart(3, '0')}`,
          kind: 'task' as const,
          data: taskData(`Undated ${index}`),
        })),
        {
          id: 'scheduled-after-undated-cap',
          kind: 'task' as const,
          data: taskData('Scheduled', { due: dateKey() }),
        },
        {
          id: 'project-far-future',
          kind: 'task' as const,
          data: taskData('Project deep link', {
            project: 'project-a',
            due: '2999-12-31',
          }),
        },
        {
          id: 'project-a',
          kind: 'project' as const,
          data: {
            title: 'Project A',
            color: '#5268e8',
            sections: [],
            background: '',
          },
        },
        {
          id: 'settings',
          kind: 'settings' as const,
          data: defaults,
        },
      ],
      'Create startup fixture',
    );
    applyEdits(
      state,
      [{ id: 'undated-001', kind: 'task', data: { _deleted: true } }],
      'Delete startup fixture record',
    );
  }, owner);
  await transact((state) => {
    applyEdits(
      state,
      [
        {
          id: 'other-owner-task',
          kind: 'task',
          data: taskData('Must not cross accounts', { due: dateKey() }),
        },
      ],
      'Create isolated fixture',
    );
  }, 'startup-projection-other');

  const projection = await startupProjection(owner, 'project-a');
  const ids = new Set(projection.map((entity) => entity.id));
  assert.equal(
    projection.filter((entity) => entity.kind === 'task' && !entity.data.due)
      .length,
    100,
  );
  assert.equal(ids.has('scheduled-after-undated-cap'), true);
  assert.equal(ids.has('project-far-future'), true);
  assert.equal(ids.has('project-a'), true);
  assert.equal(ids.has('settings'), true);
  assert.equal(ids.has('undated-001'), false);
  assert.equal(ids.has('other-owner-task'), false);
});

void test('durable search preserves substring behavior across edits and owners', async () => {
  const owner = 'durable-search';
  await transact((state) => {
    applyEdits(
      state,
      [
        {
          id: 'search-task',
          kind: 'task',
          data: taskData('Alpha Needle', {
            description: 'A searchable description',
          }),
        },
        {
          id: 'deleted-search-task',
          kind: 'task',
          data: taskData('Needle deleted'),
        },
        {
          id: 'long-search-task',
          kind: 'task',
          data: taskData('Long note', {
            description: `${'x'.repeat(4200)} searchable overflow phrase`,
          }),
        },
      ],
      'Create search fixture',
    );
    applyEdits(
      state,
      [{ id: 'deleted-search-task', kind: 'task', data: { _deleted: true } }],
      'Delete search fixture',
    );
  }, owner);
  await transact((state) => {
    applyEdits(
      state,
      [
        {
          id: 'other-search-task',
          kind: 'task',
          data: taskData('Needle in another account'),
        },
      ],
      'Create other search fixture',
    );
  }, 'durable-search-other');

  assert.deepEqual(
    (await searchRecords(owner, 'PHA NEE')).map((entity) => entity.id),
    ['search-task'],
  );
  assert.deepEqual(
    (await searchRecords(owner, 'al')).map((entity) => entity.id),
    ['search-task'],
  );
  assert.deepEqual(
    (await searchRecords(owner, 'overflow phrase')).map((entity) => entity.id),
    ['long-search-task'],
  );
  await transact((state) => {
    applyEdits(
      state,
      [
        {
          id: 'search-task',
          kind: 'task',
          data: { title: 'Haystack', description: '' },
        },
      ],
      'Update search fixture',
    );
  }, owner);
  assert.deepEqual(await searchRecords(owner, 'needle'), []);
  assert.deepEqual(
    (await searchRecords(owner, 'yst')).map((entity) => entity.id),
    ['search-task'],
  );
});

void test('concurrent saves serialize and a quota failure commits neither records nor operations', async () => {
  const owner = 'concurrent';
  const ids = [uid(), uid(), uid()];
  await Promise.all(
    ids.map((id, i) =>
      transact((s) => {
        applyEdits(
          s,
          [{ id, kind: 'task', data: taskData(`Task ${i}`) }],
          `Create ${i}`,
        );
      }, owner),
    ),
  );
  const before = await load(owner);
  const { IDBObjectStore } = await import('fake-indexeddb');
  // Retain the method itself for fault injection; calls below explicitly bind the original receiver.
  // eslint-disable-next-line typescript/unbound-method
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === 'operations')
      throw new DOMException('Quota exhausted', 'QuotaExceededError');
    return put.apply(this, args);
  };
  try {
    await assert.rejects(
      transact((s) => {
        applyEdits(
          s,
          [{ id: ids[0], kind: 'task', data: { title: 'Must not commit' } }],
          'Failed',
        );
      }, owner),
    );
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  const { closeStorage } = await import('../lib/stride/storage');
  await closeStorage();
  const saved = await load(owner);
  assert.equal(materialize(saved.fields).length, 3);
  assert.deepEqual(saved.history, before.history);
  assert.equal(
    materialize(saved.fields).find((e) => e.id === ids[0])?.data.title,
    'Task 0',
  );
});

void test('backup capture is immutable across later record and attachment edits', async () => {
  const { captureWorkspace } = await import('../lib/stride/storage');
  const owner = 'capture',
    id = uid(),
    fileId = uid();
  await transact(
    (s) =>
      applyEdits(
        s,
        [{ id, kind: 'note', data: noteData('', 'Before') }],
        'Before',
      ),
    owner,
  );
  await saveFile(fileId, new Blob(['before']), owner);
  const captured = await captureWorkspace(owner);
  await transact(
    (s) =>
      applyEdits(
        s,
        [{ id, kind: 'note', data: noteData('', 'After') }],
        'After',
      ),
    owner,
  );
  await saveFile(fileId, new Blob(['after']), owner);
  assert.equal(materialize(captured.snapshot.fields)[0].data.title, 'Before');
  assert.equal(await captured.files[0].blob.text(), 'before');
});

void test('deletion racing an edit retains the edit and offers an explicit restore conflict', () => {
  const original = blank();
  applyEdits(
    original,
    [{ id: 'delete-race', kind: 'task', data: taskData('Original') }],
    'Create',
  );
  const edited = structuredClone(original),
    deleted = structuredClone(original);
  edited.device = 'device-a';
  deleted.device = 'device-b';
  applyEdits(
    edited,
    [
      {
        id: 'delete-race',
        kind: 'task',
        data: { description: 'Do not discard this text' },
      },
    ],
    'Edit',
  );
  applyEdits(
    deleted,
    [{ id: 'delete-race', kind: 'task', data: { _deleted: true } }],
    'Delete',
  );
  const editFields = edited.outbox.at(-1)!.fields;
  const deleteFields = deleted.outbox.at(-1)!.fields;
  mergeFields(deleted, editFields);
  mergeFields(edited, deleteFields);
  assert.equal(deleted.conflicts.length, 1);
  assert.equal(edited.conflicts.length, 1);
  assert.equal(deleted.conflicts[0].key, '_deleted');
  assert.equal(deleted.conflicts[0].remote.value, false);
  assert.equal(
    materialize(deleted.fields, true)[0].data.description,
    'Do not discard this text',
  );
  mergeFields(deleted, editFields);
  assert.equal(deleted.conflicts.length, 1);
});

void test('multiple edits to one field in a transaction save the final requested value', () => {
  const state = blank();
  applyEdits(
    state,
    [
      { id: 'multi', kind: 'task', data: taskData('First') },
      { id: 'multi', kind: 'task', data: { title: 'Last' } },
    ],
    'Combined',
  );
  assert.equal(materialize(state.fields)[0].data.title, 'Last');
});

void test('a late upload acknowledgment cannot overwrite a newer restored file', async () => {
  const { acknowledgeFileTransfer, uploadProgress } =
    await import('../lib/stride/storage');
  const owner = 'upload-restore';
  await saveFile('file', new Blob(['old bytes']), owner);
  const original = (await getLocalFile('file', owner))!;
  assert.equal(await acknowledgeFileTransfer(original, original.hash, 3), true);
  await saveFile('file', new Blob(['new restored bytes']), owner);
  assert.equal(
    await acknowledgeFileTransfer(
      original,
      original.hash,
      original.blob.size,
      true,
    ),
    false,
  );
  const current = (await getLocalFile('file', owner))!;
  assert.equal(await current.blob.text(), 'new restored bytes');
  assert.equal(current.uploaded, false);
  assert.equal(await uploadProgress('file', owner), undefined);
});

void test('a download only fills an empty cache and preserves a concurrently saved file', async () => {
  const { cacheDownloadedFile } = await import('../lib/stride/storage');
  const owner = 'download-race';
  await saveFile('file', new Blob(['restored bytes']), owner);
  const cached = await cacheDownloadedFile(
    'file',
    new Blob(['stale download']),
    owner,
  );
  assert.equal(await cached.blob.text(), 'restored bytes');
  assert.equal(cached.uploaded, false);
  const missing = await cacheDownloadedFile(
    'missing',
    new Blob(['downloaded bytes']),
    owner,
  );
  assert.equal(await missing.blob.text(), 'downloaded bytes');
  assert.equal(missing.uploaded, true);
});

void test('attachment deletion is queued atomically and local bytes are retained until cloud acknowledgment', async () => {
  const { acknowledgeFileDelete, pendingFileDeletes } =
    await import('../lib/stride/storage');
  const owner = 'delete-queue';
  await saveFile(
    'private-file',
    new Blob(['private bytes']),
    owner,
    'note.txt',
  );
  await transact(
    (snapshot) =>
      applyEdits(
        snapshot,
        [
          {
            id: 'filePurge_private-file',
            kind: 'fileTombstone',
            data: { attachment: 'private-file', _deleted: true },
          },
        ],
        'Permanently removed attachment',
      ),
    owner,
    false,
    undefined,
    ['private-file'],
  );
  assert.deepEqual(
    (await pendingFileDeletes(owner)).map((entry) => entry.id),
    ['private-file'],
  );
  assert.equal(
    await (await getLocalFile('private-file', owner))!.blob.text(),
    'private bytes',
  );
  const backupAfterRemoval = JSON.parse((await exportBackup(owner)).json) as {
    files: unknown[];
  };
  assert.deepEqual(backupAfterRemoval.files, []);
  const deletion = (await pendingFileDeletes(owner))[0];
  await acknowledgeFileDelete(deletion);
  assert.equal(await getLocalFile('private-file', owner), undefined);
  assert.deepEqual(await pendingFileDeletes(owner), []);
  await saveFile(
    'private-file',
    new Blob(['restored bytes']),
    owner,
    'note.txt',
  );
  assert.equal(
    await (await getLocalFile('private-file', owner))!.blob.text(),
    'restored bytes',
  );
});

void test('a late deletion acknowledgment cannot remove a restored file', async () => {
  const { acknowledgeFileDelete, pendingFileDeletes } =
    await import('../lib/stride/storage');
  const owner = 'delete-restore-race';
  await saveFile('file', new Blob(['old bytes']), owner);
  await transact(
    (snapshot) =>
      applyEdits(
        snapshot,
        [
          {
            id: 'filePurge_file',
            kind: 'fileTombstone',
            data: { attachment: 'file', _deleted: true },
          },
        ],
        'Permanently removed attachment',
      ),
    owner,
    false,
    undefined,
    ['file'],
  );
  const deletion = (await pendingFileDeletes(owner))[0];
  await saveFile('file', new Blob(['restored bytes']), owner);
  assert.equal(await acknowledgeFileDelete(deletion), false);
  assert.equal(
    await (await getLocalFile('file', owner))!.blob.text(),
    'restored bytes',
  );
});

void test('a restore-race response cancels deletion and requeues retained bytes', async () => {
  const { pendingFileDeletes, uploadProgress } =
    await import('../lib/stride/storage');
  const { deleteRemoteFile } = await import('../lib/stride/files');
  const owner = 'delete-remote-restore-race';
  await saveFile('file', new Blob(['restored bytes']), owner);
  await transact(
    (snapshot) =>
      applyEdits(
        snapshot,
        [
          {
            id: 'filePurge_file',
            kind: 'fileTombstone',
            data: { attachment: 'file', _deleted: true },
          },
        ],
        'Permanently removed attachment',
      ),
    owner,
    false,
    undefined,
    ['file'],
  );
  const deletion = (await pendingFileDeletes(owner))[0];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('Attachment was restored', {
      status: 409,
      headers: { 'X-Stride-File-Deletion': 'cancelled' },
    });
  try {
    await deleteRemoteFile(deletion);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(await pendingFileDeletes(owner), []);
  assert.equal((await getLocalFile('file', owner))!.uploaded, false);
  assert.equal(await uploadProgress('file', owner), undefined);
});

void test('restoring an older backup clears its purge marker and cancels queued deletion', async () => {
  const { pendingFileDeletes } = await import('../lib/stride/storage');
  const owner = 'restore-purged-attachment';
  const backup = blank();
  applyEdits(
    backup,
    [
      {
        id: 'page',
        kind: 'note',
        data: noteData('', 'Recovered page'),
      },
      {
        id: 'block',
        kind: 'note',
        data: attachmentNoteData('file', 'recovered.txt'),
      },
    ],
    'Backup fixture',
  );
  await saveFile('file', new Blob(['old bytes']), owner);
  await transact(
    (snapshot) =>
      applyEdits(
        snapshot,
        [
          {
            id: 'filePurge_file',
            kind: 'fileTombstone',
            data: { attachment: 'file', _deleted: true },
          },
        ],
        'Permanently removed attachment',
      ),
    owner,
    false,
    undefined,
    ['file'],
  );
  await restoreSnapshot(
    backup,
    [
      {
        id: 'file',
        owner,
        blob: new Blob(['restored bytes']),
        hash: '',
        name: 'recovered.txt',
        uploaded: false,
      },
    ],
    owner,
  );
  assert.deepEqual(await pendingFileDeletes(owner), []);
  assert.equal(
    materialize((await load(owner)).fields).some(
      (entity) =>
        entity.kind === 'note' &&
        documentAttachments(entity.data.document).has('file'),
    ),
    true,
  );
  assert.equal(
    await (await getLocalFile('file', owner))!.blob.text(),
    'restored bytes',
  );
});

function attachmentNoteData(id: string, name: string) {
  const document: NoteDocument = {
    type: 'doc',
    content: [{ type: 'attachment', attrs: { id, name, image: false } }],
  };
  return { ...noteData('', name), document, text: noteText(document) };
}

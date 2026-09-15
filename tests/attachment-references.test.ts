import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachmentReferences,
  currentAttachmentReferences,
} from '../lib/stride/attachment-references';
import {
  blank,
  applyEdits,
  mergeFields,
  saveFile,
  transact,
  load,
  closeStorage,
} from '../lib/stride/storage';
import { exportBackup, stageBackup } from '../lib/stride/backup';
void test('attachment discovery includes archived field values, conflicts, row properties and templates', () => {
  const state = blank();
  applyEdits(
    state,
    [
      {
        id: 'block',
        kind: 'block',
        data: { page: 'page', type: 'file', order: 0, file: 'old-file' },
      },
    ],
    'Create',
  );
  const remote = structuredClone(state);
  remote.device = 'remote';
  applyEdits(
    state,
    [{ id: 'block', kind: 'block', data: { file: 'new-file' } }],
    'Replace',
  );
  applyEdits(
    remote,
    [{ id: 'block', kind: 'block', data: { file: 'competing-file' } }],
    'Competing',
  );
  mergeFields(state, remote.outbox.at(-1)!.fields);
  applyEdits(
    state,
    [
      { id: 'block', kind: 'block', data: { _deleted: true } },
      {
        id: 'row',
        kind: 'row',
        data: {
          database: 'db',
          title: 'Entry',
          values: { legacy: [{ id: 'legacy-file', name: 'Old file' }] },
          cell_upload: [{ id: 'row-file', name: 'File' }],
          cell_relation: [{ kind: 'page', id: 'not-file', name: 'Page' }],
        },
      },
      {
        id: 'page-template',
        kind: 'template',
        data: {
          title: 'Page template',
          type: 'page',
          blocks: [{ type: 'image', file: 'template-image' }],
        },
      },
      {
        id: 'row-template',
        kind: 'template',
        data: {
          title: 'Row template',
          type: 'row',
          row: { cell_file: [{ id: 'template-file', name: 'File' }] },
        },
      },
    ],
    'References',
  );
  assert.deepEqual(
    [...attachmentReferences(state)].sort(),
    [
      'old-file',
      'new-file',
      'competing-file',
      'legacy-file',
      'row-file',
      'template-image',
      'template-file',
    ].sort(),
  );
});
void test('backup staging requires bytes for historical attachments and rejects contradictory kinds without writes', async () => {
  const owner = 'historical-backup';
  await saveFile('before-file', new Blob(['before']), owner);
  await saveFile('after-file', new Blob(['after']), owner);
  await transact(
    (s) =>
      applyEdits(
        s,
        [
          {
            id: 'block',
            kind: 'block',
            data: { page: 'page', type: 'file', order: 0, file: 'before-file' },
          },
        ],
        'Before',
      ),
    owner,
  );
  await transact(
    (s) =>
      applyEdits(
        s,
        [{ id: 'block', kind: 'block', data: { file: 'after-file' } }],
        'After',
      ),
    owner,
  );
  const exported = await exportBackup(owner);
  const backup = JSON.parse(exported.json);
  assert.equal((await stageBackup(exported.json)).files.length, 2);
  backup.files = backup.files.filter(
    (file: { id: string }) => file.id !== 'before-file',
  );
  await assert.rejects(stageBackup(JSON.stringify(backup)), /missing/);
  const mixed = JSON.parse(exported.json);
  mixed.snapshot.history[0].fields[0].kind = 'page';
  await assert.rejects(stageBackup(JSON.stringify(mixed)), /entity type/);
  const invalid = JSON.parse(exported.json);
  invalid.files = [null];
  await assert.rejects(stageBackup(JSON.stringify(invalid)), /metadata/);
  assert.equal((await load(owner)).history.length, 2);
  await closeStorage();
});

void test('an explicit attachment tombstone excludes permanently removed bytes from backups', () => {
  const state = blank('owner');
  applyEdits(
    state,
    [
      {
        id: 'block',
        kind: 'block',
        data: { page: 'page', type: 'file', order: 0, file: 'private-file' },
      },
    ],
    'Attached',
  );
  applyEdits(
    state,
    [
      { id: 'block', kind: 'block', data: { file: '' } },
      {
        id: 'filePurge_private-file',
        kind: 'fileTombstone',
        data: { attachment: 'private-file', _deleted: true },
      },
    ],
    'Permanently removed attachment',
  );
  assert.equal(attachmentReferences(state).has('private-file'), false);
});

void test('a stale purge marker cannot hide another current attachment reference', () => {
  const state = blank('owner');
  applyEdits(
    state,
    [
      {
        id: 'first-block',
        kind: 'block',
        data: { page: 'page', type: 'file', order: 0, file: 'shared-file' },
      },
      {
        id: 'second-block',
        kind: 'block',
        data: { page: 'page', type: 'file', order: 1, file: 'shared-file' },
      },
      {
        id: 'filePurge_shared-file',
        kind: 'fileTombstone',
        data: { attachment: 'shared-file', _deleted: true },
      },
    ],
    'Fixture',
  );
  assert.equal(
    currentAttachmentReferences(state, 'first-block:file').has('shared-file'),
    true,
  );
});

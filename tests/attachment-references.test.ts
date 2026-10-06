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
  materialize,
  load,
  saveFile,
  transact,
  getLocalFile,
} from '../lib/stride/storage';
import {
  exportBackupArchive,
  stageBackupFile,
  restoreBackup,
} from '../lib/stride/backup';
import { noteData, noteText } from '../lib/stride/notes';
import type { NoteDocument, Field } from '../lib/stride/types';
function document(id: string): NoteDocument {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph' },
      { type: 'attachment', attrs: { id, name: `${id}.txt`, image: false } },
    ],
  };
}
function data(id: string) {
  const rich = document(id);
  return {
    ...noteData('', 'Attached note'),
    document: rich,
    text: noteText(rich),
  };
}
void test('attachment discovery includes recoverable note documents, deleted notes and conflict alternatives', () => {
  const snapshot = blank();
  applyEdits(
    snapshot,
    [{ id: 'note', kind: 'note', data: data('old-file') }],
    'Create',
  );
  applyEdits(
    snapshot,
    [
      {
        id: 'note',
        kind: 'note',
        data: {
          document: document('new-file'),
          text: noteText(document('new-file')),
        },
      },
    ],
    'Replace',
  );
  const local = snapshot.fields['note:document'];
  const remote: Field = {
    ...local,
    value: document('remote-file'),
    stamp: '999999999999999-remote',
  };
  snapshot.conflicts.push({
    id: 'document-conflict',
    entity: 'note',
    key: 'document',
    local,
    remote,
    at: new Date().toISOString(),
  });
  assert.deepEqual([...attachmentReferences(snapshot)].sort(), [
    'new-file',
    'old-file',
    'remote-file',
  ]);
  assert.deepEqual([...currentAttachmentReferences(snapshot)], ['new-file']);
  applyEdits(
    snapshot,
    [{ id: 'note', kind: 'note', data: { _deleted: true } }],
    'Delete',
  );
  assert.equal(attachmentReferences(snapshot).has('old-file'), true);
  assert.equal(attachmentReferences(snapshot).has('new-file'), true);
});
void test('archive captures historical attachment bytes and Trash restores the note', async () => {
  const owner = 'note-recovery-source';
  await saveFile(
    'historical-file',
    new Blob(['old bytes']),
    owner,
    'historical-file.txt',
  );
  await saveFile(
    'current-file',
    new Blob(['new bytes']),
    owner,
    'current-file.txt',
  );
  await transact((snapshot) => {
    applyEdits(
      snapshot,
      [{ id: 'note', kind: 'note', data: data('historical-file') }],
      'Create',
    );
    applyEdits(
      snapshot,
      [
        {
          id: 'note',
          kind: 'note',
          data: {
            document: document('current-file'),
            text: noteText(document('current-file')),
          },
        },
      ],
      'Replace',
    );
    applyEdits(
      snapshot,
      [{ id: 'note', kind: 'note', data: { _deleted: true } }],
      'Delete',
    );
  }, owner);
  const archive = await exportBackupArchive(owner);
  const staged = await stageBackupFile(archive.blob);
  assert.deepEqual(staged.files.map((file) => file.id).sort(), [
    'current-file',
    'historical-file',
  ]);
  await restoreBackup(staged, 'note-recovery-target');
  assert.equal(
    materialize((await load('note-recovery-target')).fields).length,
    0,
  );
  await transact(
    (snapshot) =>
      applyEdits(
        snapshot,
        [{ id: 'note', kind: 'note', data: { _deleted: false } }],
        'Restore from Trash',
      ),
    'note-recovery-target',
  );
  assert.equal(
    materialize((await load('note-recovery-target')).fields)[0].kind,
    'note',
  );
  assert.equal(
    await (
      await getLocalFile('historical-file', 'note-recovery-target')
    )?.blob.text(),
    'old bytes',
  );
});
void test('permanent file tombstones exclude all historic copies from future backups and sharing checks ignore only the selected note', () => {
  const snapshot = blank();
  applyEdits(
    snapshot,
    [
      { id: 'one', kind: 'note', data: data('shared-file') },
      { id: 'two', kind: 'note', data: data('shared-file') },
    ],
    'Shared file',
  );
  assert.equal(
    currentAttachmentReferences(snapshot, 'one:document').has('shared-file'),
    true,
  );
  applyEdits(
    snapshot,
    [
      {
        id: 'two',
        kind: 'note',
        data: {
          document: { type: 'doc', content: [{ type: 'paragraph' }] },
          text: '',
        },
      },
    ],
    'Remove second reference',
  );
  assert.equal(
    currentAttachmentReferences(snapshot, 'one:document').has('shared-file'),
    false,
  );
  applyEdits(
    snapshot,
    [
      {
        id: 'filePurge_shared-file',
        kind: 'fileTombstone',
        data: { attachment: 'shared-file', _deleted: true },
      },
    ],
    'Purge',
  );
  assert.equal(attachmentReferences(snapshot).has('shared-file'), false);
});

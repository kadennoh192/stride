import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blank,
  applyEdits,
  load,
  closeStorage,
  allFiles,
  listRecovery,
  materialize,
  openDB,
} from '../lib/stride/storage';
import { taskData } from '../lib/stride/types';
void test('version-two migration keeps owners, ordered operations, tombstones, and recovery bytes', async () => {
  const original = blank('alice');
  applyEdits(
    original,
    [{ id: 'task-a', kind: 'task', data: taskData('Original') }],
    'Create',
  );
  applyEdits(
    original,
    [{ id: 'task-a', kind: 'task', data: { _deleted: true } }],
    'Delete',
  );
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('stride-workspace', 2);
    request.onupgradeneeded = () => {
      for (const store of ['state', 'files', 'recovery', 'fileQueue'])
        request.result.createObjectStore(store);
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['state', 'files'], 'readwrite');
      tx.objectStore('state').put(original, 'workspace:alice');
      tx.objectStore('state').put(blank('bob'), 'workspace:bob');
      tx.objectStore('files').put(
        {
          id: 'file-a',
          owner: 'alice',
          name: 'source.txt',
          blob: new Blob(['source bytes']),
          hash: '',
          uploaded: false,
        },
        'alice:file-a',
      );
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
  const migrated = await load('alice');
  assert.deepEqual(
    migrated.outbox.map((c) => c.id),
    original.outbox.map((c) => c.id),
  );
  assert.equal(materialize(migrated.fields).length, 0);
  assert.equal(materialize(migrated.fields, true)[0].deleted, true);
  assert.equal((await load('bob')).history.length, 0);
  assert.equal((await allFiles('alice')).length, 1);
  const recovery = (await listRecovery('alice'))[0];
  assert.equal(await recovery.files[0].blob.text(), 'source bytes');
  assert.deepEqual(recovery.snapshot, original);
  const db = await openDB();
  const legacy = await new Promise<unknown>((resolve) => {
    const r = db
      .transaction('state')
      .objectStore('state')
      .get('workspace:alice');
    r.onsuccess = () => resolve(r.result);
  });
  assert.deepEqual(legacy, original);
  await closeStorage();
  assert.deepEqual(
    (await load('alice')).outbox.map((c) => c.id),
    original.outbox.map((c) => c.id),
  );
});

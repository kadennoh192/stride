import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blank,
  applyEdits,
  load,
  listRecovery,
  materialize,
  closeStorage,
} from '../lib/stride/storage';
import { taskData } from '../lib/stride/types';

void test('schema eight upgrades metadata and preserves fields, queued operations, files, and recovery', async () => {
  const source = blank('owner');
  source.version = 2;
  applyEdits(
    source,
    [{ id: 'legacy-task', kind: 'task', data: taskData('Keep my task') }],
    'Created task',
  );
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('stride-workspace', 7);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [
        'state',
        'files',
        'recovery',
        'fileQueue',
        'fileDeletes',
      ])
        db.createObjectStore(name);
      const records = db.createObjectStore('records', {
        keyPath: ['owner', 'id'],
      });
      records.createIndex('owner', 'owner');
      records.createIndex('ownerKind', ['owner', 'kind']);
      const meta = db.createObjectStore('meta', { keyPath: 'owner' });
      const fields = db.createObjectStore('fields', {
        keyPath: ['owner', 'fieldKey'],
      });
      fields.createIndex('owner', 'owner');
      const operations = db.createObjectStore('operations', {
        keyPath: ['owner', 'id'],
      });
      operations.createIndex('owner', 'owner');
      const conflicts = db.createObjectStore('conflicts', {
        keyPath: ['owner', 'id'],
      });
      conflicts.createIndex('owner', 'owner');
      void meta;
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(
        ['meta', 'fields', 'operations', 'files'],
        'readwrite',
      );
      const {
        fields: _fields,
        outbox: _outbox,
        history: _history,
        conflicts: _conflicts,
        ...meta
      } = source;
      tx.objectStore('meta').put({ ...meta, revision: 1 });
      for (const [fieldKey, field] of Object.entries(source.fields))
        tx.objectStore('fields').put({ ...field, owner: 'owner', fieldKey });
      source.history.forEach((change, sequence) =>
        tx
          .objectStore('operations')
          .put({ owner: 'owner', id: change.id, change, pending: 1, sequence }),
      );
      tx.objectStore('files').put(
        {
          id: 'file-a',
          owner: 'owner',
          name: 'keep.txt',
          blob: new Blob(['keep']),
          uploaded: false,
        },
        'owner:file-a',
      );
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
  const migrated = await load('owner');
  assert.equal(migrated.version, 3);
  assert.equal(materialize(migrated.fields)[0].data.title, 'Keep my task');
  assert.equal(migrated.outbox.length, 1);
  const recovery = (await listRecovery('owner')).find((item) =>
    item.key.endsWith('migration-v8'),
  );
  assert.equal(recovery?.snapshot.version, 2);
  assert.equal(await recovery?.files[0].blob.text(), 'keep');
  await closeStorage();
});

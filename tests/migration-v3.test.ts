import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

void test('version-three records gain active indexes without reviving tombstones', async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('stride-workspace', 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['state', 'files', 'recovery', 'fileQueue'])
        db.createObjectStore(name);
      const records = db.createObjectStore('records', {
        keyPath: ['owner', 'id'],
      });
      records.createIndex('ownerKind', ['owner', 'kind']);
      records.createIndex('owner', 'owner');
      records.createIndex('container', ['owner', 'kind', 'container']);
      records.createIndex('due', ['owner', 'kind', 'due']);
      db.createObjectStore('meta', { keyPath: 'owner' });
      const fields = db.createObjectStore('fields', {
        keyPath: ['owner', 'fieldKey'],
      });
      fields.createIndex('owner', 'owner');
      fields.createIndex('entity', ['owner', 'entity']);
      const operations = db.createObjectStore('operations', {
        keyPath: ['owner', 'id'],
      });
      operations.createIndex('owner', 'owner');
      operations.createIndex('pending', ['owner', 'pending']);
      const conflicts = db.createObjectStore('conflicts', {
        keyPath: ['owner', 'id'],
      });
      conflicts.createIndex('owner', 'owner');
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('records', 'readwrite');
      const records = tx.objectStore('records');
      records.put({
        owner: 'alice',
        id: 'active',
        kind: 'task',
        container: 'project-a',
        due: '',
        data: { title: 'Active' },
      });
      records.put({
        owner: 'alice',
        id: 'deleted',
        kind: 'task',
        container: 'project-a',
        due: '',
        deleted: true,
        data: { title: 'Deleted' },
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });

  const { indexedRecords, openDB, searchRecords } =
    await import('../lib/stride/storage');
  assert.deepEqual(
    (await indexedRecords('alice', 'task', 'project-a')).map(
      (record) => record.data.title,
    ),
    ['Active'],
  );
  const db = await openDB();
  assert.equal(
    db
      .transaction('records')
      .objectStore('records')
      .indexNames.contains('ownerKindDueActive'),
    true,
  );
  assert.deepEqual(
    (await searchRecords('alice', 'ctiv')).map((record) => record.id),
    ['active'],
  );
  const records = await new Promise<Record<string, unknown>[]>(
    (resolve, reject) => {
      const request = db.transaction('records').objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    },
  );
  assert.deepEqual(
    records.map((record) => [record.id, record.active]),
    [
      ['active', 1],
      ['deleted', 0],
    ],
  );
});

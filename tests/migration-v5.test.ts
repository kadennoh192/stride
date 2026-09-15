import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { taskData } from '../lib/stride/types';

void test('version-five records gain bounded search indexes without reviving tombstones', async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('stride-workspace', 5);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of ['state', 'files', 'recovery', 'fileQueue'])
        database.createObjectStore(name);
      const records = database.createObjectStore('records', {
        keyPath: ['owner', 'id'],
      });
      records.createIndex('ownerKind', ['owner', 'kind']);
      records.createIndex('owner', 'owner');
      records.createIndex('container', ['owner', 'kind', 'container']);
      records.createIndex('due', ['owner', 'kind', 'due']);
      records.createIndex('ownerKindActive', ['owner', 'kind', 'active']);
      records.createIndex('containerActive', [
        'owner',
        'kind',
        'container',
        'active',
      ]);
      records.createIndex('ownerKindActiveId', [
        'owner',
        'kind',
        'active',
        'id',
      ]);
      records.createIndex('containerActiveId', [
        'owner',
        'kind',
        'container',
        'active',
        'id',
      ]);
      records.createIndex('ownerKindDueActive', [
        'owner',
        'kind',
        'active',
        'due',
        'id',
      ]);
      database.createObjectStore('meta', { keyPath: 'owner' });
      const fields = database.createObjectStore('fields', {
        keyPath: ['owner', 'fieldKey'],
      });
      fields.createIndex('owner', 'owner');
      fields.createIndex('entity', ['owner', 'entity']);
      const operations = database.createObjectStore('operations', {
        keyPath: ['owner', 'id'],
      });
      operations.createIndex('owner', 'owner');
      operations.createIndex('pending', ['owner', 'pending']);
      const conflicts = database.createObjectStore('conflicts', {
        keyPath: ['owner', 'id'],
      });
      conflicts.createIndex('owner', 'owner');
    };
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction('records', 'readwrite');
      const records = tx.objectStore('records');
      records.put({
        owner: 'alice',
        id: 'active',
        kind: 'task',
        active: 1,
        container: '',
        due: '',
        data: taskData('Search migration needle'),
      });
      records.put({
        owner: 'alice',
        id: 'overflow',
        kind: 'task',
        active: 1,
        container: '',
        due: '',
        data: taskData('Long note', {
          description: `${'x'.repeat(4200)} overflow migration phrase`,
        }),
      });
      records.put({
        owner: 'alice',
        id: 'deleted',
        kind: 'task',
        active: 0,
        container: '',
        due: '',
        deleted: true,
        data: taskData('Deleted migration needle'),
      });
      tx.oncomplete = () => {
        database.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });

  const { openDB, searchRecords } = await import('../lib/stride/storage');
  const database = await openDB();
  assert.equal(database.objectStoreNames.contains('fileDeletes'), true);
  const recordsStore = database.transaction('records').objectStore('records');
  assert.equal(recordsStore.indexNames.contains('searchGrams'), true);
  assert.equal(
    recordsStore.indexNames.contains('ownerKindSearchOverflow'),
    true,
  );
  assert.deepEqual(
    (await searchRecords('alice', 'migration needle')).map(
      (record) => record.id,
    ),
    ['active'],
  );
  assert.deepEqual(
    (await searchRecords('alice', 'overflow migration phrase')).map(
      (record) => record.id,
    ),
    ['overflow'],
  );
  const stored = await new Promise<Record<string, unknown>[]>(
    (resolve, reject) => {
      const read = database
        .transaction('records')
        .objectStore('records')
        .getAll();
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    },
  );
  assert.equal(
    (
      (stored.find((record) => record.id === 'deleted')?.searchGrams ||
        []) as unknown[]
    ).length,
    0,
  );
  assert.equal(
    stored.find((record) => record.id === 'overflow')?.searchOverflow,
    1,
  );
});

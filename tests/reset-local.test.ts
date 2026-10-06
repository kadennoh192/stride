import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeStorage,
  openDB,
  load,
  transact,
  applyEdits,
  materialize,
  localResetStatus,
} from '../lib/stride/storage';
import { RESET_GENERATION } from '../lib/stride/reset-generation';
import { taskData } from '../lib/stride/types';

void test('schema nine permanently purges every legacy store without recovery and resets once', async () => {
  for (const version of [1, 2, 3, 4, 5, 6, 7, 8]) {
    await closeStorage();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('stride-workspace');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    const previous = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('stride-workspace', version);
      request.onupgradeneeded = () => {
        // Known and unknown legacy stores are both cleared by the boundary.
        for (const name of [
          'state',
          'files',
          'recovery',
          'fileQueue',
          'fileDeletes',
          'legacySnapshots',
        ])
          request.result.createObjectStore(name);
        if (version >= 3) {
          const db = request.result;
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
          const records = db.createObjectStore('records', {
            keyPath: ['owner', 'id'],
          });
          records.createIndex('ownerKind', ['owner', 'kind']);
          records.createIndex('owner', 'owner');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = previous.transaction(
        Array.from(previous.objectStoreNames),
        'readwrite',
      );
      for (const name of Array.from(previous.objectStoreNames)) {
        const store = tx.objectStore(name);
        const record = {
          owner: 'owner',
          id: 'old',
          fieldKey: 'old:title',
          entity: 'old',
          kind: 'page',
          key: 'title',
          value: 'erase permanently',
          stamp: '000000000000001-old',
          privateData: 'erase permanently',
          bytes: new Blob(['private']),
          pending: 1,
        };
        if (store.keyPath) store.put(record);
        else store.put(record, 'old');
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    previous.close();
    const database = await openDB();
    assert.equal(database.version, 9);
    for (const name of Array.from(database.objectStoreNames).filter(
      (name) => name !== 'reset',
    )) {
      const count = await new Promise<number>((resolve, reject) => {
        const request = database.transaction(name).objectStore(name).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      assert.equal(
        count,
        0,
        `schema ${version}: ${name} still contains old records`,
      );
    }
    assert.equal(Object.keys((await load('owner')).fields).length, 0);
    assert.equal(
      ((await localResetStatus()) as { generation: string }).generation,
      RESET_GENERATION,
    );
    await transact(
      (state) =>
        applyEdits(
          state,
          [
            {
              id: 'new-task',
              kind: 'task',
              data: taskData('Created after reset'),
            },
          ],
          'Create',
        ),
      'owner',
    );
    await closeStorage();
    const reopened = await load('owner');
    assert.equal(
      materialize(reopened.fields)[0].data.title,
      'Created after reset',
    );
    assert.equal(reopened.history.length, 1);
  }
  await closeStorage();
});

import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { taskData } from '../lib/stride/types';
void test('version-one workspace migrates into unclaimed guest storage without clearing its data', async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('stride-workspace', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('state');
      request.result.createObjectStore('files');
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('state', 'readwrite');
      const fields = Object.fromEntries(
        Object.entries(taskData('Legacy task')).map(([key, value]) => [
          `legacy:${key}`,
          {
            entity: 'legacy',
            kind: 'task',
            key,
            value,
            stamp: '000000000000001-legacy',
          },
        ]),
      );
      tx.objectStore('state').put(
        {
          version: 1,
          fields,
          owner: 'old-chatgpt-user',
          outbox: [],
          history: [],
          clock: 1,
          device: 'legacy',
          cursor: 0,
          initialized: true,
          lastSync: '',
        },
        'workspace',
      );
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
  const { load, materialize, openDB } = await import('../lib/stride/storage');
  const state = await load('guest');
  assert.equal(state.version, 2);
  assert.equal(materialize(state.fields)[0].data.title, 'Legacy task');
  const db = await openDB();
  const snapshot = await new Promise<unknown>((resolve) => {
    const r = db
      .transaction('recovery')
      .objectStore('recovery')
      .get('legacy-v1');
    r.onsuccess = () => resolve(r.result);
  });
  assert.ok(snapshot);
});

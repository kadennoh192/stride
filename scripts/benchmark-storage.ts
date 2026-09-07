import 'fake-indexeddb/auto';
import { performance } from 'node:perf_hooks';
import {
  transact,
  applyEdits,
  indexedRecords,
  closeStorage,
} from '../lib/stride/storage';
import { taskData } from '../lib/stride/types';
import type { Edit } from '../lib/stride/storage';
const owner = 'synthetic-benchmark';
const started = performance.now();
for (let offset = 0; offset < 60000; offset += 500) {
  const edits: Edit[] = Array.from({ length: 500 }, (_, index) => {
    const n = offset + index;
    return n < 10000
      ? { id: `task-${n}`, kind: 'task', data: taskData(`Task ${n}`) }
      : {
          id: `row-${n}`,
          kind: 'row',
          data: { title: `Row ${n}`, database: 'benchmark-db', cell_amount: n },
        };
  });
  await transact((s) => {
    applyEdits(s, edits, 'Load synthetic dataset');
  }, owner);
  if ((offset + 500) % 10000 === 0)
    console.log(`Prepared ${offset + 500} records`);
}
const samples: number[] = [];
for (let n = 0; n < 20; n++) {
  const start = performance.now();
  await transact((s) => {
    applyEdits(
      s,
      [{ id: 'task-5000', kind: 'task', data: { title: `Edited ${n}` } }],
      'Small edit',
    );
  }, owner);
  samples.push(performance.now() - start);
}
const queryStart = performance.now();
const page = await indexedRecords(owner, 'row', 'benchmark-db', 100, 10000);
const queryMs = performance.now() - queryStart;
console.log(
  JSON.stringify(
    {
      environment:
        'Node fake-indexeddb; diagnostic, not reference-device/browser evidence',
      tasks: 10000,
      rows: 50000,
      setupMs: Math.round(performance.now() - started),
      editMedianMs: samples.sort((a, b) => a - b)[10],
      editMaxMs: Math.max(...samples),
      indexedPageMs: queryMs,
      pageSize: page.length,
    },
    null,
    2,
  ),
);
await closeStorage();

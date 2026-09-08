import 'fake-indexeddb/auto';
import { performance } from 'node:perf_hooks';
import {
  transact,
  applyEdits,
  indexedRecordPage,
  startupProjection,
  closeStorage,
} from '../lib/stride/storage';
import { taskData } from '../lib/stride/types';
import type { Edit } from '../lib/stride/storage';
const owner = 'synthetic-benchmark';
const recordCount = Number(process.env.STRIDE_BENCHMARK_RECORDS || 60000);
const sampleCount = Number(process.env.STRIDE_BENCHMARK_EDITS || 20);
if (!Number.isInteger(recordCount) || recordCount < 1000)
  throw new Error(
    'STRIDE_BENCHMARK_RECORDS must be an integer of at least 1,000.',
  );
if (!Number.isInteger(sampleCount) || sampleCount < 1)
  throw new Error('STRIDE_BENCHMARK_EDITS must be a positive integer.');
const taskCount = Math.min(10000, Math.max(1, Math.round(recordCount / 6)));
const idWidth = String(recordCount - 1).length;
const started = performance.now();
for (let offset = 0; offset < recordCount; offset += 500) {
  const batchSize = Math.min(500, recordCount - offset);
  const edits: Edit[] = Array.from({ length: batchSize }, (_, index) => {
    const n = offset + index;
    const id = String(n).padStart(idWidth, '0');
    return n < taskCount
      ? { id: `task-${id}`, kind: 'task', data: taskData(`Task ${n}`) }
      : {
          id: `row-${id}`,
          kind: 'row',
          data: { title: `Row ${n}`, database: 'benchmark-db', cell_amount: n },
        };
  });
  await transact((s) => {
    applyEdits(s, edits, 'Load synthetic dataset');
  }, owner);
  const prepared = offset + batchSize;
  if (prepared % 10000 === 0 || prepared === recordCount)
    console.log(`Prepared ${prepared} records`);
}
const setupMs = performance.now() - started;
const queryStart = performance.now();
const queryOffset = Math.min(10000, Math.max(0, recordCount - taskCount - 100));
const afterId = `row-${String(taskCount + queryOffset - 1).padStart(
  idWidth,
  '0',
)}`;
const page = await indexedRecordPage(
  owner,
  'row',
  'benchmark-db',
  100,
  afterId,
);
const queryMs = performance.now() - queryStart;
console.log(`Measured indexed page (${page.length} records)`);
const startupReadStart = performance.now();
const startup = await startupProjection(owner);
const startupReadMs = performance.now() - startupReadStart;
console.log(`Measured startup projection (${startup.length} records)`);
const samples: number[] = [];
for (let n = 0; n < sampleCount; n++) {
  const start = performance.now();
  await transact((s) => {
    applyEdits(
      s,
      [
        {
          id: `task-${String(Math.floor(taskCount / 2)).padStart(idWidth, '0')}`,
          kind: 'task',
          data: { title: `Edited ${n}` },
        },
      ],
      'Small edit',
    );
  }, owner);
  samples.push(performance.now() - start);
  console.log(`Measured edit ${n + 1}/${sampleCount}`);
}
console.log(
  JSON.stringify(
    {
      environment:
        'Node fake-indexeddb; diagnostic, not reference-device/browser evidence',
      tasks: taskCount,
      rows: recordCount - taskCount,
      setupMs: Math.round(setupMs),
      editMedianMs: samples.sort((a, b) => a - b)[
        Math.floor(samples.length / 2)
      ],
      editMaxMs: Math.max(...samples),
      indexedPageMs: queryMs,
      pageSize: page.length,
      startupProjectionMs: startupReadMs,
      startupProjectionSize: startup.length,
    },
    null,
    2,
  ),
);
await closeStorage();

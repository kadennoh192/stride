import test from 'node:test';
import assert from 'node:assert/strict';
import { completionEdits } from '../lib/stride/completion';
import {
  applyEdits,
  blank,
  materialize,
  mergeFields,
} from '../lib/stride/storage';
import { taskData, type Task } from '../lib/stride/types';

void test('simultaneous recurring completion converges to one event without a conflict', async () => {
  const base = blank();
  applyEdits(
    base,
    [
      {
        id: 'recurring-task',
        kind: 'task',
        data: taskData('Weekly review', {
          due: '2026-09-07',
          recurrence: 'weekly',
        }),
      },
    ],
    'Created task',
  );
  const task = materialize(base.fields).find(
    (record): record is Task => record.kind === 'task',
  )!;
  const left = structuredClone(base);
  const right = structuredClone(base);
  left.device = 'left-device';
  right.device = 'right-device';
  const leftTransition = await completionEdits(
    task,
    new Date('2026-09-07T14:00:00.000Z'),
  );
  const rightTransition = await completionEdits(
    task,
    new Date('2026-09-07T14:00:03.000Z'),
  );
  assert.equal(leftTransition.id, rightTransition.id);
  assert.match(leftTransition.id, /^completion-[a-f0-9]{40}$/);
  applyEdits(left, leftTransition.edits, 'Completed on left device');
  applyEdits(right, rightTransition.edits, 'Completed on right device');
  mergeFields(left, right.outbox.at(-1)!.fields);

  const records = materialize(left.fields);
  assert.equal(
    records.filter((record) => record.kind === 'completion').length,
    1,
  );
  assert.equal(
    records.find((record) => record.id === 'recurring-task')?.data.due,
    '2026-09-14',
  );
  assert.equal(left.conflicts.length, 0);
});

void test('completion IDs stay valid for maximum-length imported task IDs', async () => {
  const task: Task = {
    id: 't'.repeat(150),
    kind: 'task',
    data: taskData('Long imported identity'),
  };
  const transition = await completionEdits(
    task,
    new Date('2026-09-07T14:00:00.000Z'),
  );
  assert.ok(transition.id.length <= 150);
  const state = blank();
  assert.doesNotThrow(() =>
    applyEdits(state, [task, ...transition.edits], 'Completed imported task'),
  );
});

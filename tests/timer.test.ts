import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, applyEdits, materialize } from '../lib/stride/storage';
import { finishElapsedTimer } from '../lib/stride/timer';
void test('elapsed timers finalize once after closure and prepare a paused next interval', () => {
  const state = blank();
  applyEdits(
    state,
    [
      {
        id: 'settings',
        kind: 'settings',
        data: {
          cycles: 2,
          longBreakMinutes: 20,
          activeTimer: {
            id: 'timer-one',
            phase: 'focus',
            duration: 1500,
            remaining: 1500,
            end: Date.parse('2026-09-06T10:00:00Z'),
            running: true,
            cycle: 2,
            task: 'task-one',
          },
        },
      },
    ],
    'Start timer',
  );
  assert.equal(
    finishElapsedTimer(state, Date.parse('2026-09-06T09:59:59Z')),
    false,
  );
  assert.equal(
    finishElapsedTimer(state, Date.parse('2026-09-07T10:00:00Z')),
    true,
  );
  assert.equal(
    finishElapsedTimer(state, Date.parse('2026-09-07T10:00:01Z')),
    false,
  );
  const records = materialize(state.fields);
  assert.equal(records.filter((e) => e.kind === 'session').length, 1);
  const session = records.find((e) => e.kind === 'session')!;
  assert.equal(session.data.at, '2026-09-06T10:00:00.000Z');
  assert.equal(session.data.task, 'task-one');
  const timer = records.find((e) => e.kind === 'settings')!.data
    .activeTimer as { phase: string; running: boolean; duration: number };
  assert.equal(timer.phase, 'longBreak');
  assert.equal(timer.duration, 1200);
  assert.equal(timer.running, false);
});

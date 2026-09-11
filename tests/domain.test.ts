import test from 'node:test';
import assert from 'node:assert/strict';
import { taskData, type Task } from '../lib/stride/types';
import {
  nextOccurrence,
  dependencyCycle,
  zonedInstant,
  validDate,
  safeURL,
  embedURL,
} from '../lib/stride/domain';
import { formula } from '../lib/stride/formula';
const task = (extra: Record<string, unknown>): Task => ({
  id: 'task-1',
  kind: 'task',
  data: taskData('Test', extra),
});
void test('recurrence preserves month-end anchor and handles weekdays', () => {
  assert.equal(
    nextOccurrence(task({ due: '2026-01-31', recurrence: 'monthly' })),
    '2026-02-28',
  );
  assert.equal(
    nextOccurrence(
      task({
        due: '2026-02-28',
        recurrence: 'monthly',
        recurrenceAnchor: '2026-01-31',
      }),
    ),
    '2026-03-31',
  );
  assert.equal(
    nextOccurrence(task({ due: '2026-09-04', recurrence: 'weekdays' })),
    '2026-09-07',
  );
  assert.equal(
    nextOccurrence(
      task({ due: '2026-01-01', recurrence: 'after-days:3', timezone: 'UTC' }),
      new Date('2026-09-05T12:00Z'),
    ),
    '2026-09-08',
  );
});
void test('dependency cycles reject indirect loops', () => {
  const a = task({ dependencies: ['b'] });
  assert.equal(dependencyCycle('b', ['task-1'], [a]), true);
  assert.equal(dependencyCycle('b', [], [a]), false);
});
void test('timezone conversion covers DST gaps and ambiguous times', () => {
  assert.equal(
    new Date(
      zonedInstant('2026-11-01', '01:30', 'America/Toronto'),
    ).toISOString(),
    '2026-11-01T05:30:00.000Z',
  );
  assert.equal(
    new Date(
      zonedInstant('2026-03-08', '02:30', 'America/Toronto'),
    ).toISOString(),
    '2026-03-08T07:00:00.000Z',
  );
  assert.equal(
    new Date(zonedInstant('2026-09-05', '09:00', 'Asia/Kolkata')).toISOString(),
    '2026-09-05T03:30:00.000Z',
  );
});
void test('dates and links reject invalid or executable values', () => {
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(safeURL('javascript:alert(1)'), '');
  assert.equal(embedURL('https://evil.example/embed'), '');
  assert.ok(
    embedURL('https://www.youtube.com/watch?v=dQw4w9WgXcQ').startsWith(
      'https://www.youtube-nocookie.com/',
    ),
  );
});
void test('formula interpreter supports expressions without code execution', () => {
  assert.equal(
    formula('prop("Hours") * 60 + 5', () => 2),
    125,
  );
  assert.equal(
    formula('if(2 > 1, upper("yes"), "no")', () => null),
    'YES',
  );
  assert.equal(
    formula('dateDiff("2026-09-05", "2026-09-01")', () => null),
    4,
  );
  assert.equal(
    formula('sum(1,2,3) / 2', () => null),
    3,
  );
  assert.throws(() => formula('globalThis.process.exit()', () => null));
  assert.throws(() => formula('1 / 0', () => null));
  assert.throws(() => formula('constructor("alert(1)")', () => null));
});

void test('formula conditions and boolean operators evaluate only the selected branch', () => {
  const unread = () => {throw new Error('This branch must not read properties');};
  assert.equal(formula('if(false, 1 / 0, 1)', unread),1);
  assert.equal(formula('if(true, "selected", prop("unused"))',unread),'selected');
  assert.equal(formula('false && prop("unused")',unread),false);
  assert.equal(formula('true || prop("unused")',unread),true);
  assert.throws(()=>formula('if(true, 1 / 0, 1)',unread),/zero/);
});

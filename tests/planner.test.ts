import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaults,
  taskData,
  type Assignment,
  type Entity,
  type Project,
  type Task,
} from '../lib/stride/types';
import {
  planWorkspace,
  projectHealth,
  estimateSuggestion,
  zonedInstant,
} from '../lib/stride/planner';
import { completionEdits } from '../lib/stride/completion';
import { applyEdits, blank, materialize } from '../lib/stride/storage';

const settings = {
  ...defaults,
  timezone: 'UTC',
  workingDays: [1, 2, 3, 4, 5],
  workStart: '09:00',
  workEnd: '12:00',
};
const task = (id: string, extra: Partial<Task['data']> = {}): Task => ({
  id,
  kind: 'task',
  data: taskData(id, { timezone: 'UTC', duration: 60, ...extra }),
});

void test('wall-clock planning follows timezone across daylight saving', () => {
  assert.equal(
    zonedInstant('2026-03-06', '09:00', 'America/Toronto').toISOString(),
    '2026-03-06T14:00:00.000Z',
  );
  assert.equal(
    zonedInstant('2026-03-09', '09:00', 'America/Toronto').toISOString(),
    '2026-03-09T13:00:00.000Z',
  );
});

void test('planner setup and card order persist in the existing settings record', () => {
  const state = blank();
  applyEdits(
    state,
    [
      {
        id: 'settings',
        kind: 'settings',
        data: {
          ...defaults,
          plannerSetup: true,
          workingDays: [1, 3, 5],
          workStart: '08:30',
          workEnd: '16:00',
          weatherEnabled: true,
          weatherLocation: 'gps',
          dashboardCards: ['next', 'plan'],
        },
      },
    ],
    'Setup',
  );
  const stored = materialize(state.fields).find(
    (item) => item.kind === 'settings',
  );
  assert.equal(stored?.data.plannerSetup, true);
  assert.deepEqual(stored?.data.dashboardCards, ['next', 'plan']);
  assert.equal(stored?.data.weatherLocation, 'gps');
});
const project: Project = {
  id: 'project',
  kind: 'project',
  data: {
    title: 'Project',
    color: '#6179d9',
    sections: [],
    background: '',
    deadline: '2026-09-21',
    startedAt: '2026-09-01T00:00:00.000Z',
  },
};

void test('planner treats fixed task times and School due times correctly, with dependencies and capacity', () => {
  const fixed = task('fixed', { due: '2026-09-21', time: '09:00' });
  const assignment: Assignment = {
    id: 'school',
    kind: 'assignment',
    data: {
      title: 'Homework',
      course: 'course',
      type: 'Homework',
      description: '',
      priority: 2,
      status: 'To do',
      due: '2026-09-21',
      time: '11:00',
      timezone: 'UTC',
      duration: 30,
      attachments: [],
      category: '',
      score: null,
      possible: 100,
      expectedScore: null,
      reminders: [],
      alarms: [],
      completedAt: '',
    },
  };
  const first = task('first', { priority: 1, due: '2026-09-21' });
  const dependent = task('dependent', {
    priority: 2,
    due: '2026-09-21',
    duration: 30,
    dependencies: ['first'],
  });
  const overflow = task('overflow', {
    priority: 4,
    due: '2026-09-21',
    duration: 90,
  });
  const plan = planWorkspace(
    [fixed, assignment, first, dependent, overflow],
    settings,
    new Date('2026-09-21T08:00:00Z'),
  );
  assert.equal(
    plan.blocks.find((block) => block.id === 'first')?.start,
    '2026-09-21T10:30:00.000Z',
  );
  assert.equal(
    plan.blocks.find((block) => block.id === 'school')?.start,
    '2026-09-21T10:00:00.000Z',
  );
  assert.equal(plan.blocks.find((block) => block.id === 'school')?.fixed, false);
  assert.equal(
    plan.blocks.find((block) => block.id === 'dependent')?.start,
    '2026-09-21T11:30:00.000Z',
  );
  assert.ok(plan.issues.some((issue) => issue.id === 'overflow'));
  assert.equal(plan.days[0].fixed, 60);
  assert.equal(plan.days[0].planned, 120);
});

void test('overdue rescheduling keeps due date and yields one reversible batch', () => {
  const overdue = task('overdue', {
    due: '2026-09-18',
    plannedStart: '2026-09-18T09:00:00.000Z',
  });
  const proposal = planWorkspace(
    [overdue],
    settings,
    new Date('2026-09-21T08:00:00Z'),
    14,
    true,
  );
  assert.equal(proposal.changes[0]?.plannedStart, '2026-09-21T09:00:00.000Z');
  const state = blank();
  applyEdits(state, [overdue], 'Add task');
  applyEdits(
    state,
    proposal.changes.map((change) => ({
      id: change.id,
      kind: change.kind,
      data: { plannedStart: change.plannedStart },
    })),
    'Reschedule',
  );
  const changed = materialize(state.fields).find(
    (item) => item.id === 'overdue',
  ) as Task;
  assert.equal(changed.data.due, '2026-09-18');
  assert.equal(changed.data.plannedStart, proposal.changes[0].plannedStart);
  applyEdits(
    state,
    [
      {
        id: overdue.id,
        kind: 'task',
        data: { plannedStart: proposal.changes[0].before },
      },
    ],
    'Undo',
  );
  assert.equal(
    (materialize(state.fields).find((item) => item.id === 'overdue') as Task)
      .data.plannedStart,
    overdue.data.plannedStart,
  );
});

void test('completed recurring task loses its old planned slot', async () => {
  const recurring = task('recurring', {
    due: '2026-09-21',
    recurrence: 'daily',
    plannedStart: '2026-09-21T09:00:00.000Z',
  });
  const result = await completionEdits(
    recurring,
    new Date('2026-09-21T10:00:00Z'),
  );
  const edit = result.edits.find((item) => item.kind === 'task');
  assert.equal(
    (edit?.data as { plannedStart?: string } | undefined)?.plannedStart,
    '',
  );
});

void test('project health flags stalled, blocked and overloaded work', () => {
  const blocked = task('blocked', {
    project: 'project',
    dependencies: ['other'],
    due: '2026-09-20',
    duration: 240,
  });
  const other = task('other', { project: 'inbox', duration: 240 });
  const issues = projectHealth(
    project,
    [project, blocked, other],
    settings,
    new Date('2026-09-21T08:00:00Z'),
  );
  assert.ok(issues.includes('Overdue work'));
  assert.ok(issues.includes('No next action'));
  assert.ok(issues.includes('No progress for 14 days'));
  assert.ok(issues.includes('Remaining work exceeds capacity before deadline'));
});

void test('estimate learning requires three completed peers with linked focus sessions', () => {
  const target = task('target', { project: 'project', priority: 2 });
  const peers: Entity[] = [30, 40, 50].flatMap((value, index) => {
    const id = `peer-${index}`;
    return [
      task(id, {
        project: 'project',
        priority: 2,
        completedAt: '2026-09-20T12:00:00Z',
      }),
      {
        id: `session-${index}`,
        kind: 'session' as const,
        data: {
          at: '2026-09-20T12:00:00Z',
          duration: value * 60,
          phase: 'focus' as const,
          task: id,
        },
      },
    ];
  });
  assert.equal(estimateSuggestion(target, peers.slice(0, 4)), null);
  assert.equal(estimateSuggestion(target, peers), 40);
});

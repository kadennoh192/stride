import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  courseAverage,
  gradeLetter,
  defaultThresholds,
} from '../lib/stride/school';
import { calculateStreak } from '../lib/stride/streak';
import { validateEntity, ValidationError } from '../lib/stride/validation';
import { applyEdits, blank, materialize } from '../lib/stride/storage';
import type { Assignment, Course, Habit, HabitLog } from '../lib/stride/types';

const course = (mode: Course['data']['gradingMode']): Course => ({
  id: 'course-1',
  kind: 'course',
  data: {
    title: 'Math',
    instructor: '',
    color: '#5268e8',
    term: '',
    targetGrade: 80,
    gradingMode: mode,
    categories: [
      { id: 'quiz', title: 'Quizzes', weight: 40 },
      { id: 'exam', title: 'Exams', weight: 60 },
    ],
    thresholds: defaultThresholds,
  },
});
const assignment = (
  id: string,
  score: number | null,
  possible: number,
  category = 'quiz',
  expectedScore: number | null = null,
): Assignment => ({
  id,
  kind: 'assignment',
  data: {
    title: id,
    course: 'course-1',
    type: 'Quiz',
    description: '',
    priority: 4,
    status: 'To do',
    due: '',
    time: '',
    timezone: 'UTC',
    attachments: [],
    category,
    score,
    possible,
    expectedScore,
    reminders: [],
    alarms: [],
    completedAt: '',
  },
});
void test('all grading modes exclude missing grades and projections require explicit expectations', () => {
  const items = [
    assignment('a', 8, 10),
    assignment('b', 60, 100, 'exam'),
    assignment('c', null, 100, 'exam', 100),
  ];
  assert.equal(courseAverage(course('none'), items), null);
  assert.equal(courseAverage(course('points'), items), (100 * 68) / 110);
  assert.equal(courseAverage(course('percent'), items), 70);
  assert.equal(courseAverage(course('weighted'), items), 68);
  assert.equal(courseAverage(course('weighted'), items, true), 80);
  assert.equal(courseAverage(course('points'), [items[2]]), null);
  assert.equal(courseAverage(course('points'), [items[2]], true), 100);
});
void test('thresholds are editable and weighted categories must total 100 percent', () => {
  const item = course('weighted');
  validateEntity(item);
  assert.equal(gradeLetter(85, item.data.thresholds), 'B');
  assert.equal(
    gradeLetter(85, [
      { letter: 'Distinction', minimum: 85 },
      { letter: 'Pass', minimum: 0 },
    ]),
    'Distinction',
  );
  item.data.categories[0].weight = 50;
  assert.throws(() => validateEntity(item), ValidationError);
});
const habit = (days: number[] = [0, 1, 2, 3, 4, 5, 6]): Habit => ({
  id: 'habit-1',
  kind: 'habit',
  data: {
    title: 'Read',
    icon: '📖',
    goal: 1,
    unit: 'times',
    color: '#5268e8',
    reminder: '',
    days,
  },
});
const log = (date: string, value = 1): HabitLog => ({
  id: `log-${date}`,
  kind: 'habitLog',
  data: { habit: 'habit-1', date, value },
});
void test('streak awards freezes at seven days, caps at two, and consumes the first missed day', () => {
  const logs = Array.from({ length: 21 }, (_, index) =>
    log(`2026-09-${String(index + 1).padStart(2, '0')}`),
  );
  const result = calculateStreak([habit()], logs, '2026-09-24');
  assert.equal(result.longest, 21);
  assert.equal(result.freezes, 0);
  assert.equal(result.used, 2);
  assert.deepEqual(result.milestones, [7, 14, 21]);
  assert.equal(result.days.at(-1)?.data.outcome, 'freeze');
  assert.equal(result.current, 21);
});
void test('rest days are neutral and requirement caps at scheduled habit count', () => {
  const monday = habit([1]);
  const result = calculateStreak(
    [monday],
    [log('2026-09-07'), log('2026-09-14')],
    '2026-09-15',
    3,
  );
  assert.equal(result.current, 2);
  assert.equal(result.days.at(-1)?.data.outcome, 'neutral');
  assert.equal(result.days[0].data.requirement, 1);
});
void test('streak calculation converges across log order and historical edits', () => {
  const logs = [log('2026-09-01'), log('2026-09-02'), log('2026-09-03', 0)];
  const forward = calculateStreak([habit()], logs, '2026-09-04');
  const reverse = calculateStreak([habit()], [...logs].reverse(), '2026-09-04');
  assert.deepEqual(forward, reverse);
  assert.equal(forward.current, 0);
  logs[2].data.value = 1;
  assert.equal(calculateStreak([habit()], logs, '2026-09-04').current, 3);
});
void test('education-level changes preserve course and assignment records', () => {
  const state = blank();
  applyEdits(
    state,
    [
      { id: 'course-1', kind: 'course', data: course('points').data },
      {
        id: 'assignment-1',
        kind: 'assignment',
        data: assignment('assignment-1', 8, 10).data,
      },
      {
        id: 'settings',
        kind: 'settings',
        data: { educationLevel: 'highSchool', schoolSetup: true },
      },
    ],
    'School setup',
  );
  applyEdits(
    state,
    [
      {
        id: 'settings',
        kind: 'settings',
        data: { educationLevel: 'university' },
      },
    ],
    'Changed education level',
  );
  const records = materialize(state.fields);
  assert.equal(
    records.find((record) => record.id === 'course-1')?.kind,
    'course',
  );
  assert.equal(
    records.find((record) => record.id === 'assignment-1')?.kind,
    'assignment',
  );
  assert.equal(
    records.find((record) => record.id === 'settings')?.data.educationLevel,
    'university',
  );
});
void test('check-ins, shower sessions, and simultaneous focus/shower timers validate', () => {
  validateEntity({
    id: 'check-2026-09-22',
    kind: 'checkIn',
    data: {
      date: '2026-09-22',
      mood: 4,
      energy: 3,
      stress: 2,
      sleepHours: 7.5,
      note: '',
    },
  });
  validateEntity({
    id: 'shower-1',
    kind: 'showerSession',
    data: {
      at: '2026-09-22T12:00:00.000Z',
      duration: 420,
      targetMinutes: 10,
      flowLitresPerMinute: 9,
    },
  });
  validateEntity({
    id: 'settings',
    kind: 'settings',
    data: {
      activeTimer: {
        id: 'timer-1',
        phase: 'focus',
        duration: 1500,
        remaining: 1500,
        end: 1501,
        running: true,
        cycle: 1,
        task: '',
      },
      activeShowerTimer: {
        startedAt: 1,
        elapsedSeconds: 0,
        running: true,
        targetMinutes: 10,
        flowLitresPerMinute: 9,
      },
    },
  });
  assert.throws(
    () =>
      validateEntity({
        id: 'bad-check',
        kind: 'checkIn',
        data: {
          date: '2026-09-22',
          mood: 6,
          energy: 3,
          stress: 2,
          sleepHours: 7,
          note: '',
        },
      }),
    ValidationError,
  );
});

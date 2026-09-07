import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, applyEdits } from '../lib/stride/storage';
import {
  validateEntity,
  validConflict,
  validField,
} from '../lib/stride/validation';
import { defaults, taskData } from '../lib/stride/types';
void test('runtime validation rejects malformed task, editor, schema, settings, and conflict data', () => {
  for (const data of [
    { dependencies: [{}] },
    { checklist: [{ title: 'Missing identity' }] },
    { duration: 'one' },
    { status: 'Unknown' },
    { timezone: 'Invalid/Zone' },
  ])
    assert.throws(() =>
      validateEntity({
        id: 'task',
        kind: 'task',
        data: taskData('Task', data),
      }),
    );
  assert.throws(() =>
    validateEntity({
      id: 'block',
      kind: 'block',
      data: { page: 'page', type: 'script', order: 0 },
    }),
  );
  for (const entity of [
    {
      id: 'project',
      kind: 'project' as const,
      data: { title: 'Project', color: 'url(https://tracker.example/pixel)' },
    },
    {
      id: 'page',
      kind: 'page' as const,
      data: { title: 'Page', cover: 'linear-gradient(red, blue)' },
    },
    {
      id: 'habit',
      kind: 'habit' as const,
      data: {
        title: 'Habit',
        goal: 1,
        days: [1],
        color: 'currentColor',
        unit: 'times',
      },
    },
  ])
    assert.throws(() => validateEntity(entity));
  for (const data of [
    { theme: 'solarized' },
    { accent: 'url(https://tracker.example/pixel)' },
    { workspaceBackground: 'transparent' },
    { density: 'microscopic' },
    { font: 'remote-font' },
    { motion: 'yes' },
    { rightPanel: 1 },
    { hidden: ['today', 'unknown'] },
    { navOrder: ['today', 'today'] },
    { dailyGoal: 0 },
    { model: '../invalid' },
    { taskPaneWidth: 10000 },
    {
      activeTimer: {
        id: 'timer',
        phase: 'focus',
        duration: 60,
        remaining: 61,
        end: 0,
        running: true,
        cycle: 0,
        task: '../invalid',
      },
    },
  ])
    assert.throws(() =>
      validateEntity({ id: 'settings', kind: 'settings', data }),
    );
  assert.doesNotThrow(() =>
    validateEntity({ id: 'settings', kind: 'settings', data: defaults }),
  );
  assert.doesNotThrow(() =>
    validateEntity({
      id: 'settings',
      kind: 'settings',
      data: {
        ...defaults,
        theme: 'custom',
        workspaceBackground: '#111827',
        surfaceColor: '#1f2937',
        textColor: '#f9fafb',
      },
    }),
  );
  assert.throws(() =>
    validateEntity({
      id: 'db',
      kind: 'database',
      data: {
        title: 'Database',
        properties: [
          { id: 'p', name: 'Property', type: 'number', options: [] },
          { id: 'p', name: 'Duplicate', type: 'text', options: [] },
        ],
      },
    }),
  );
  assert.throws(() =>
    validateEntity({
      id: 'settings',
      kind: 'settings',
      data: { focusMinutes: 0 },
    }),
  );
  assert.equal(validConflict({ id: 'bad', local: {}, remote: {} }), false);
  assert.equal(
    validField({
      entity: 'task',
      kind: 'task',
      key: 'title',
      value: 'Task',
      stamp: '000000000000001-test',
      base: 'invalid',
    }),
    false,
  );
  assert.doesNotThrow(() =>
    validateEntity({
      id: 'comment',
      kind: 'comment',
      data: {
        target: 'page',
        text: 'Personal note',
        at: new Date().toISOString(),
      },
    }),
  );
  for (const entity of [
    {
      id: 'comment',
      kind: 'comment' as const,
      data: { target: 'page', text: 'Note', at: 'not-a-date' },
    },
    {
      id: 'view',
      kind: 'view' as const,
      data: { title: 'View', hidden: [3] },
    },
    {
      id: 'template',
      kind: 'template' as const,
      data: { title: 'Template', type: 'unknown' },
    },
    {
      id: 'favorite',
      kind: 'favorite' as const,
      data: { title: 'Favorite', tip: -1 },
    },
    {
      id: 'session',
      kind: 'session' as const,
      data: {
        at: new Date().toISOString(),
        duration: 60,
        phase: 'focus',
        task: '../bad',
      },
    },
  ])
    assert.throws(() => validateEntity(entity));
});
void test('staged parent and dependency graphs reject indirect and same-transaction cycles', () => {
  const state = blank();
  applyEdits(
    state,
    [
      { id: 'parent', kind: 'page', data: { title: 'Parent', parent: '' } },
      { id: 'child', kind: 'page', data: { title: 'Child', parent: 'parent' } },
    ],
    'Pages',
  );
  assert.throws(
    () =>
      applyEdits(
        state,
        [{ id: 'parent', kind: 'page', data: { parent: 'child' } }],
        'Cycle',
      ),
    /cycle/,
  );
  assert.throws(
    () =>
      applyEdits(
        state,
        [
          {
            id: 'a',
            kind: 'task',
            data: taskData('A', { dependencies: ['b'] }),
          },
          {
            id: 'b',
            kind: 'task',
            data: taskData('B', { dependencies: ['a'] }),
          },
        ],
        'Cycle',
      ),
    /cycle/,
  );
});

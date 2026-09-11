import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, applyEdits, materialize } from '../lib/stride/storage';
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
    { taskViews: { today: 'gallery' } },
    { taskViews: { '../unsafe': 'list' } },
    { calendarView: 'decade' },
    { calendarSpan: 10 },
    { calendarShowCompleted: 'yes' },
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
        taskViews: { today: 'list', 'project/project-id': 'board' },
        calendarView: 'multi-week',
        calendarSpan: 6,
        calendarShowCompleted: true,
      },
    }),
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

void test('database schemas validate typed cells, relations, and existing rows', () => {
  for (const properties of [
    [
      { id: 'one', name: 'Same', type: 'text', options: [] },
      { id: 'two', name: 'Same', type: 'number', options: [] },
    ],
    [{ id: 'one', name: 'Text', type: 'text', options: [], target: 'page' }],
    [
      { id: 'one', name: 'Text', type: 'text', options: [] },
      {
        id: 'rollup',
        name: 'Rollup',
        type: 'rollup',
        options: [],
        relation: 'one',
      },
    ],
  ])
    assert.throws(() =>
      validateEntity({
        id: 'invalid-database',
        kind: 'database',
        data: { title: 'Invalid database', properties },
      }),
    );
  const state = blank();
  applyEdits(
    state,
    [
      { id: 'related-page', kind: 'page', data: { title: 'Related page' } },
      {
        id: 'database',
        kind: 'database',
        data: {
          title: 'Typed database',
          properties: [
            { id: 'number', name: 'Number', type: 'number', options: [] },
            {
              id: 'status',
              name: 'Status',
              type: 'status',
              options: ['Open', 'Done'],
            },
            { id: 'date', name: 'Date', type: 'date', options: [] },
            { id: 'link', name: 'Link', type: 'url', options: [] },
            { id: 'files', name: 'Files', type: 'files', options: [] },
            {
              id: 'relation',
              name: 'Relation',
              type: 'relation',
              options: [],
              target: 'page',
            },
          ],
          dateProperty: 'date',
        },
      },
      {
        id: 'row',
        kind: 'row',
        data: {
          database: 'database',
          title: 'Valid row',
          values: {
            number: -4.5,
            status: 'Open',
            date: '2026-09-07',
            link: 'https://example.com',
            files: [{ id: 'file-one', name: 'Evidence.txt' }],
            relation: ['related-page'],
            removed_property: 'retained for undo',
          },
        },
      },
    ],
    'Valid typed database',
  );
  for (const [property, value] of [
    ['number', 'four'],
    ['status', 'Unknown'],
    ['date', '2026-02-30'],
    ['link', 'javascript:alert(1)'],
    ['files', [{ id: '../bad', name: 'Bad' }]],
    ['relation', ['row']],
  ] as const)
    assert.throws(() =>
      applyEdits(
        state,
        [{ id: 'row', kind: 'row', data: { [`cell_${property}`]: value } }],
        'Invalid typed value',
      ),
    );
  assert.throws(() =>
    applyEdits(
      state,
      [
        {
          id: 'database',
          kind: 'database',
          data: {
            properties: [
              { id: 'number', name: 'Number', type: 'date', options: [] },
            ],
            dateProperty: 'number',
          },
        },
      ],
      'Incompatible schema change',
    ),
  );
  const persisted = materialize(state.fields).find(
    (entity) => entity.id === 'database',
  );
  assert.equal(persisted?.kind, 'database');
  if (persisted?.kind !== 'database') throw new Error('Database not found');
  assert.equal(persisted.data.properties[0].type, 'number');
});

import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEdits,
  getLocalFile,
  load,
  materialize,
  mergeFields,
  saveFile,
  transact,
  type Edit,
} from '../lib/stride/storage';
import {
  exportBackupArchive,
  restoreBackup,
  stageBackupFile,
} from '../lib/stride/backup';
import { defaults, taskData, type Property } from '../lib/stride/types';
import { kinds } from '../lib/stride/validation';

void test('complete archive restores every record kind and attachment-bearing structure', async () => {
  const sourceOwner = 'matrix-source';
  const targetOwner = 'matrix-target';
  const attachments = [
    ['block-file', 'block.txt', 'block bytes'],
    ['row-file', 'row.txt', 'row bytes'],
    ['template-file', 'template.txt', 'template bytes'],
  ] as const;
  for (const [id, name, contents] of attachments)
    await saveFile(
      id,
      new Blob([contents], { type: 'text/plain' }),
      sourceOwner,
      name,
    );

  const properties: Property[] = [
    { id: 'prop-text', name: 'Text', type: 'text', options: [] },
    { id: 'prop-number', name: 'Number', type: 'number', options: [] },
    { id: 'prop-select', name: 'Select', type: 'select', options: ['A', 'B'] },
    {
      id: 'prop-multi',
      name: 'Multi',
      type: 'multi-select',
      options: ['A', 'B'],
    },
    { id: 'prop-status', name: 'Status', type: 'status', options: ['Open'] },
    { id: 'prop-date', name: 'Date', type: 'date', options: [] },
    { id: 'prop-check', name: 'Check', type: 'checkbox', options: [] },
    { id: 'prop-url', name: 'URL', type: 'url', options: [] },
    { id: 'prop-email', name: 'Email', type: 'email', options: [] },
    { id: 'prop-phone', name: 'Phone', type: 'phone', options: [] },
    { id: 'prop-files', name: 'Files', type: 'files', options: [] },
    { id: 'prop-person', name: 'Person', type: 'person', options: [] },
    {
      id: 'prop-relation',
      name: 'Relation',
      type: 'relation',
      options: [],
      target: 'page',
    },
    {
      id: 'prop-rollup',
      name: 'Rollup',
      type: 'rollup',
      options: [],
      relation: 'prop-relation',
      property: 'duration',
      aggregate: 'sum',
    },
    {
      id: 'prop-formula',
      name: 'Formula',
      type: 'formula',
      options: [],
      expression: 'prop("Number") * 2',
    },
  ];
  const edits: Edit[] = [
    {
      id: 'project-main',
      kind: 'project',
      data: {
        title: 'Launch',
        color: '#5268e8',
        sections: ['Planning', 'Delivery'],
        background: '#f6f7fa',
      },
    },
    {
      id: 'task-main',
      kind: 'task',
      data: taskData('Ship Stride', {
        description: 'Full fidelity task',
        project: 'project-main',
        section: 'Delivery',
        due: '2026-09-07',
        time: '14:30',
        priority: 1,
        tags: ['release'],
        recurrence: 'weekly:1',
        duration: 45,
        checklist: [{ id: 'check-one', title: 'Verify', done: true }],
        reminders: ['due', 'before:10'],
        repeatMinutes: 15,
        important: true,
      }),
    },
    {
      id: 'page-main',
      kind: 'page',
      data: {
        title: 'Release notes',
        icon: '📝',
        cover: '#5268e8',
        parent: '',
      },
    },
    {
      id: 'block-rich',
      kind: 'block',
      data: {
        page: 'page-main',
        type: 'paragraph',
        text: 'Structured content',
        rich: { type: 'doc', content: [{ type: 'paragraph' }] },
        order: 1,
        checked: false,
      },
    },
    {
      id: 'block-file-record',
      kind: 'block',
      data: {
        page: 'page-main',
        type: 'file',
        text: 'Attachment',
        file: 'block-file',
        name: 'block.txt',
        order: 2,
        checked: false,
      },
    },
    {
      id: 'database-main',
      kind: 'database',
      data: {
        title: 'Release database',
        properties: properties.map((property) => ({ ...property })),
        dateProperty: 'prop-date',
      },
    },
    {
      id: 'row-main',
      kind: 'row',
      data: {
        database: 'database-main',
        title: 'Version 1',
        values: {
          'prop-text': 'Ready',
          'prop-number': 21,
          'prop-select': 'A',
          'prop-multi': ['A', 'B'],
          'prop-status': 'Open',
          'prop-date': '2026-09-07',
          'prop-check': true,
          'prop-url': 'https://example.com',
          'prop-email': 'owner@example.com',
          'prop-phone': '+1 555 0100',
          'prop-files': [{ id: 'row-file', name: 'row.txt' }],
          'prop-person': 'owner',
          'prop-relation': ['page-main'],
        },
      },
    },
    {
      id: 'habit-main',
      kind: 'habit',
      data: {
        title: 'Walk',
        icon: '🚶',
        goal: 8,
        unit: 'km',
        color: '#22a06b',
        reminder: '08:30',
        days: [1, 2, 3, 4, 5],
      },
    },
    {
      id: 'habit-log-main',
      kind: 'habitLog',
      data: { habit: 'habit-main', date: '2026-09-07', value: 9, goal: 8 },
    },
    {
      id: 'session-main',
      kind: 'session',
      data: {
        at: '2026-09-07T14:30:00.000Z',
        duration: 1500,
        phase: 'focus',
        task: 'task-main',
      },
    },
    {
      id: 'countdown-main',
      kind: 'countdown',
      data: {
        title: 'Launch day',
        date: '2026-12-01T15:00:00.000Z',
        timezone: 'America/Toronto',
      },
    },
    {
      id: 'settings',
      kind: 'settings',
      data: {
        ...defaults,
        name: 'Kaden',
        theme: 'dark',
        accent: '#ff6b35',
        hidden: ['matrix'],
        navOrder: ['today', 'upcoming'],
        timezone: 'America/Toronto',
      },
    },
    {
      id: 'view-main',
      kind: 'view',
      data: {
        title: 'Open releases',
        database: 'database-main',
        layout: 'board',
        query: 'ready',
        filterProp: 'prop-status',
        filterValue: 'Open',
        sort: 'prop-date',
        descending: true,
        group: 'prop-status',
        hidden: ['prop-phone'],
      },
    },
    {
      id: 'comment-main',
      kind: 'comment',
      data: {
        target: 'page-main',
        text: 'Review before publishing',
        at: '2026-09-07T15:00:00.000Z',
      },
    },
    {
      id: 'completion-main',
      kind: 'completion',
      data: {
        task: 'task-main',
        at: '2026-09-07T16:00:00.000Z',
        title: 'Ship Stride',
        due: '2026-09-07',
      },
    },
    {
      id: 'template-page',
      kind: 'template',
      data: {
        type: 'page',
        title: 'Release page',
        pageTemplate: { title: 'Release', icon: '🚀', cover: '', parent: '' },
        blocks: [
          {
            type: 'file',
            text: 'Template attachment',
            file: 'template-file',
            name: 'template.txt',
            order: 1,
            checked: false,
          },
        ],
      },
    },
    {
      id: 'template-row',
      kind: 'template',
      data: {
        type: 'row',
        title: 'Release row',
        database: 'database-main',
        row: {
          database: 'database-main',
          title: 'Template row',
          values: { 'prop-status': 'Open' },
        },
      },
    },
    {
      id: 'favorite-main',
      kind: 'favorite',
      data: { title: 'Protect focus time', tip: 3 },
    },
    {
      id: 'filePurge_old-file',
      kind: 'fileTombstone',
      data: { attachment: 'old-file' },
    },
  ];

  await transact(
    (snapshot) => applyEdits(snapshot, edits, 'Created full content matrix'),
    sourceOwner,
  );
  const sourceRecords = materialize((await load(sourceOwner)).fields).sort(
    (a, b) => a.id.localeCompare(b.id),
  );
  assert.deepEqual(
    [...new Set(sourceRecords.map((record) => record.kind))].sort(),
    [...kinds].sort(),
  );

  const archive = await exportBackupArchive(sourceOwner);
  const staged = await stageBackupFile(archive.blob);
  assert.equal(staged.records, sourceRecords.length);
  assert.equal(staged.files.length, attachments.length);
  await restoreBackup(staged, targetOwner);

  const restored = await load(targetOwner);
  const restoredRecords = materialize(restored.fields)
    .map(({ id, kind, data }) => ({ id, kind, data }))
    .sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(
    restoredRecords,
    sourceRecords.map(({ id, kind, data }) => ({ id, kind, data })),
  );
  assert.ok(
    restored.history.some(
      (change) => change.label === 'Created full content matrix',
    ),
  );
  for (const [id, , contents] of attachments)
    assert.equal(
      await (await getLocalFile(id, targetOwner))?.blob.text(),
      contents,
    );
});

void test('archive restore retains tombstones and both conflict alternatives', async () => {
  const sourceOwner = 'conflict-archive-source';
  const targetOwner = 'conflict-archive-target';
  await transact(
    (snapshot) =>
      applyEdits(
        snapshot,
        [
          {
            id: 'conflicted-task',
            kind: 'task',
            data: taskData('Original title'),
          },
          {
            id: 'deleted-page',
            kind: 'page',
            data: { title: 'Deleted page', icon: '', cover: '', parent: '' },
          },
        ],
        'Created conflict fixture',
      ),
    sourceOwner,
  );
  const remote = structuredClone(await load(sourceOwner));
  remote.device = 'remote-device';
  applyEdits(
    remote,
    [{ id: 'conflicted-task', kind: 'task', data: { title: 'Remote title' } }],
    'Remote edit',
  );
  await transact((snapshot) => {
    applyEdits(
      snapshot,
      [{ id: 'conflicted-task', kind: 'task', data: { title: 'Local title' } }],
      'Local edit',
    );
    mergeFields(snapshot, remote.outbox.at(-1)!.fields);
    applyEdits(
      snapshot,
      [{ id: 'deleted-page', kind: 'page', data: { _deleted: true } }],
      'Deleted page',
    );
  }, sourceOwner);

  const source = await load(sourceOwner);
  assert.equal(source.conflicts.length, 1);
  assert.equal(
    materialize(source.fields, true).find(
      (record) => record.id === 'deleted-page',
    )?.deleted,
    true,
  );
  const archive = await exportBackupArchive(sourceOwner);
  const staged = await stageBackupFile(archive.blob);
  assert.deepEqual(staged.backup.snapshot.conflicts, source.conflicts);
  await restoreBackup(staged, targetOwner);

  const restored = await load(targetOwner);
  assert.deepEqual(restored.conflicts, source.conflicts);
  assert.equal(
    materialize(restored.fields, true).find(
      (record) => record.id === 'deleted-page',
    )?.deleted,
    true,
  );
  assert.equal(
    materialize(restored.fields).some((record) => record.id === 'deleted-page'),
    false,
  );
});

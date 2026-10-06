import { noteData, noteText } from '../lib/stride/notes';
import type { NoteDocument } from '../lib/stride/types';
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
import { defaults, taskData } from '../lib/stride/types';
import { kinds } from '../lib/stride/validation';
import { defaultThresholds } from '../lib/stride/school';

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

  const document: NoteDocument = {
    type: 'doc',
    content: attachments.map(([id, name]) => ({
      type: 'attachment',
      attrs: { id, name, image: false },
    })),
  };
  const edits: Edit[] = [
    {
      id: 'notes-folder',
      kind: 'folder',
      data: { title: 'Release', parent: '' },
    },
    {
      id: 'release-note',
      kind: 'note',
      data: {
        ...noteData('notes-folder', 'Release note'),
        document,
        text: noteText(document),
      },
    },
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
      id: 'filePurge_old-file',
      kind: 'fileTombstone',
      data: { attachment: 'old-file' },
    },
    {
      id: 'course-main',
      kind: 'course',
      data: {
        title: 'Mathematics',
        instructor: 'A. Teacher',
        color: '#5268e8',
        term: 'Fall',
        targetGrade: 85,
        gradingMode: 'weighted',
        categories: [
          { id: 'quizzes', title: 'Quizzes', weight: 40 },
          { id: 'exams', title: 'Exams', weight: 60 },
        ],
        thresholds: defaultThresholds,
      },
    },
    {
      id: 'assignment-main',
      kind: 'assignment',
      data: {
        title: 'Quiz 1',
        course: 'course-main',
        type: 'Quiz',
        description: 'Algebra',
        priority: 2,
        status: 'Done',
        due: '2026-09-07',
        time: '11:00',
        timezone: 'America/Toronto',
        attachments: [{ id: 'block-file', name: 'block.txt' }],
        category: 'quizzes',
        score: 8,
        possible: 10,
        expectedScore: null,
        reminders: ['due'],
        alarms: [],
        completedAt: '2026-09-07T15:00:00.000Z',
      },
    },
    {
      id: 'alarm-main',
      kind: 'alarm',
      data: {
        label: 'Study',
        timezone: 'America/Toronto',
        enabled: true,
        sound: 'chime',
        volume: 0.7,
        vibration: true,
        snoozeMinutes: 10,
        nextOccurrence: '2026-12-01T14:00:00.000Z',
        linkedKind: '',
        linkedId: '',
        acknowledgedOccurrence: '',
        respectQuietHours: false,
        schedule: { rule: 'once', date: '2026-12-01', time: '09:00' },
      },
    },
    {
      id: 'shower-main',
      kind: 'showerSession',
      data: {
        at: '2026-09-07T15:00:00.000Z',
        duration: 480,
        targetMinutes: 10,
        flowLitresPerMinute: 9,
      },
    },
    {
      id: 'checkin-main',
      kind: 'checkIn',
      data: {
        date: '2026-09-07',
        mood: 4,
        energy: 3,
        stress: 2,
        sleepHours: 8,
        note: 'Good day',
      },
    },
    {
      id: 'streak-2026-09-07',
      kind: 'streakDay',
      data: {
        date: '2026-09-07',
        scheduled: 1,
        completed: 1,
        requirement: 1,
        outcome: 'complete',
        streak: 1,
        freezes: 0,
      },
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
            id: 'deleted-note',
            kind: 'note',
            data: noteData('', 'Deleted note'),
          },
          {
            id: 'conflicted-task',
            kind: 'task',
            data: taskData('Original title'),
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
      [{ id: 'deleted-note', kind: 'note', data: { _deleted: true } }],
      'Deleted note',
    );
  }, sourceOwner);

  const source = await load(sourceOwner);
  assert.equal(source.conflicts.length, 1);
  assert.equal(
    materialize(source.fields, true).find(
      (record) => record.id === 'deleted-note',
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
      (record) => record.id === 'deleted-note',
    )?.deleted,
    true,
  );
  assert.equal(
    materialize(restored.fields).some((record) => record.id === 'deleted-note'),
    false,
  );
});

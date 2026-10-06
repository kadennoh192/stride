import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  noteData,
  noteText,
  sortNotes,
  noteTitle,
  folderDeletionEdits,
  resolveTaskLayout,
} from '../lib/stride/notes';
import {
  applyEdits,
  blank,
  materialize,
  transact,
  load,
  searchRecords,
  openDB,
  type Edit,
} from '../lib/stride/storage';
import {
  defaults,
  type Note,
  type Folder,
  type NoteDocument,
} from '../lib/stride/types';
import { validNoteDocument } from '../lib/stride/validation';
import {
  stageNoteDraft,
  flushNoteDraft,
  readNoteDraft,
  hasUnsavedNoteDrafts,
  recoverableNoteDrafts,
  trackNoteAttachment,
} from '../lib/stride/note-drafts';
import { normalizeRoute } from '../lib/stride/routes';
const document = (text: string): NoteDocument => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
async function create(owner: string, id = 'note') {
  await transact(
    (state) =>
      applyEdits(
        state,
        [{ id, kind: 'note', data: noteData() }],
        'Created note',
      ),
    owner,
  );
  return materialize((await load(owner)).fields).find(
    (item) => item.id === id,
  ) as Note;
}
void test('continuous document supports formatting, lists, tables, checklist and durable attachments', () => {
  const rich: NoteDocument = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [
          {
            type: 'text',
            text: 'Heading',
            marks: [{ type: 'bold' }, { type: 'italic' }],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Link',
            marks: [{ type: 'link', attrs: { href: 'https://example.test' } }],
          },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Bullet' }],
              },
            ],
          },
        ],
      },
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Checked' }],
              },
            ],
          },
        ],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Cell' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'attachment',
        attrs: { id: 'durable-file', name: 'photo.png', image: true },
      },
    ],
  };
  assert.equal(validNoteDocument(rich), true);
  assert.match(noteText(rich), /Heading\nLink/);
  assert.match(noteText(rich), /Checked/);
  assert.match(noteText(rich), /Cell\nphoto.png/);
  assert.equal(
    validNoteDocument({
      type: 'doc',
      content: [
        {
          type: 'attachment',
          attrs: { id: 'blob:temporary', name: 'x', image: true },
        },
      ],
    }),
    false,
  );
  assert.equal(
    validNoteDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Unsafe',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    }),
    false,
  );
});
void test('folder moves reject cycles; deleting a folder reparents children, moves notes and supports Undo', () => {
  const state = blank('folders');
  applyEdits(
    state,
    [
      { id: 'root', kind: 'folder', data: { title: 'Root', parent: '' } },
      { id: 'child', kind: 'folder', data: { title: 'Child', parent: 'root' } },
      { id: 'note', kind: 'note', data: noteData('root') },
    ],
    'Created',
  );
  assert.throws(
    () =>
      applyEdits(
        state,
        [{ id: 'root', kind: 'folder', data: { parent: 'child' } }],
        'Cycle',
      ),
    /cycle/,
  );
  const folder = materialize(state.fields).find(
    (item) => item.id === 'root',
  ) as Folder;
  const previous = materialize(state.fields);
  applyEdits(state, folderDeletionEdits(folder, previous), 'Deleted folder');
  const entities = materialize(state.fields);
  assert.equal(
    (entities.find((item) => item.id === 'note') as Note).data.folder,
    '',
  );
  assert.equal(
    (entities.find((item) => item.id === 'child') as Folder).data.parent,
    '',
  );
  assert.equal(
    entities.some((item) => item.id === 'root'),
    false,
  );
  applyEdits(
    state,
    previous.map(
      (item) =>
        ({
          id: item.id,
          kind: item.kind,
          data: { ...item.data, _deleted: false },
        }) as Edit,
    ),
    'Undo',
  );
  assert.equal(
    (materialize(state.fields).find((item) => item.id === 'note') as Note).data
      .folder,
    'root',
  );
});
void test('pins precede edit order, untitled fallback and note body search remain account scoped', async () => {
  const note = await create('search-notes');
  await stageNoteDraft(
    'search-notes',
    note,
    '',
    document('needle in the document'),
  );
  await flushNoteDraft('search-notes', note.id);
  const saved = materialize((await load('search-notes')).fields)[0] as Note;
  assert.equal(noteTitle(saved), 'Untitled note');
  assert.ok(saved.data.updatedAt >= saved.data.createdAt);
  assert.equal((await searchRecords('search-notes', 'needle')).length, 1);
  assert.equal((await searchRecords('other-owner', 'needle')).length, 0);
  const pinned = {
    ...saved,
    id: 'pinned',
    data: {
      ...saved.data,
      pinned: true,
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
  };
  assert.equal(sortNotes([saved, pinned])[0].id, 'pinned');
});
void test('draft retry persists retained edits after a quota failure and flush handles rapid staging', async () => {
  const owner = 'failed-draft',
    note = await create(owner),
    db = await openDB();
  const original = db.transaction.bind(db);
  db.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
    if (args[0] === 'noteDrafts')
      throw new DOMException('Full', 'QuotaExceededError');
    return original(...args);
  }) as IDBDatabase['transaction'];
  await assert.rejects(
    stageNoteDraft(owner, note, 'Retained', document('unsaved')),
  );
  assert.equal(hasUnsavedNoteDrafts(), true);
  assert.equal((await readNoteDraft(owner, note.id))?.title, 'Retained');
  db.transaction = original;
  await flushNoteDraft(owner, note.id);
  assert.equal(
    (materialize((await load(owner)).fields)[0] as Note).data.title,
    'Retained',
  );
  await Promise.all([
    stageNoteDraft(owner, note, 'First', document('1')),
    stageNoteDraft(owner, note, 'Latest', document('2')),
  ]);
  await Promise.all([
    flushNoteDraft(owner, note.id),
    flushNoteDraft(owner, note.id),
  ]);
  assert.equal(
    (materialize((await load(owner)).fields)[0] as Note).data.title,
    'Latest',
  );
  assert.equal((await recoverableNoteDrafts(owner, note.id)).length, 0);
});
void test('remote changes and removed notes retain drafts instead of overwriting; explicit replacement is safe', async () => {
  const owner = 'conflicted-draft',
    note = await create(owner);
  await stageNoteDraft(owner, note, 'Local', document('local'));
  await transact(
    (state) =>
      applyEdits(
        state,
        [{ id: note.id, kind: 'note', data: { title: 'Remote' } }],
        'Remote edit',
      ),
    owner,
  );
  await assert.rejects(flushNoteDraft(owner, note.id), /another tab or device/);
  assert.equal(
    (materialize((await load(owner)).fields)[0] as Note).data.title,
    'Remote',
  );
  assert.equal((await recoverableNoteDrafts(owner, note.id))[0].title, 'Local');
  await flushNoteDraft(owner, note.id, true);
  assert.equal(
    (materialize((await load(owner)).fields)[0] as Note).data.title,
    'Local',
  );
});
void test('navigation flush waits for asynchronous attachment storage and owner scopes remain separate', async () => {
  const owner = 'upload-draft',
    note = await create(owner);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const upload = trackNoteAttachment(owner, note.id, async () => {
    await gate;
    await stageNoteDraft(
      owner,
      note,
      'Uploaded',
      document('attachment staged'),
    );
  });
  let finished = false;
  const flush = flushNoteDraft(owner, note.id).then(() => {
    finished = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(finished, false);
  assert.equal(hasUnsavedNoteDrafts(), true);
  release();
  await upload;
  await flush;
  assert.equal(
    (materialize((await load(owner)).fields)[0] as Note).data.title,
    'Uploaded',
  );
  assert.equal(materialize((await load('unrelated')).fields).length, 0);
});
void test('layout configuration resolves live overrides and stale routes have deliberate destinations', () => {
  const settings = structuredClone(defaults);
  assert.equal(resolveTaskLayout(settings, 'inbox'), 'list');
  settings.taskLayout = 'board';
  settings.taskViews.inbox = 'table';
  assert.equal(resolveTaskLayout(settings, 'inbox'), 'table');
  assert.equal(resolveTaskLayout(settings, 'tasks'), 'board');
  delete settings.taskViews.inbox;
  assert.equal(resolveTaskLayout(settings, 'inbox'), 'board');
  settings.taskViews['project/work'] = 'timeline';
  assert.equal(resolveTaskLayout(settings, 'project/work'), 'timeline');
  for (const route of [
    'explore',
    'databases',
    'filters',
    'database/old',
    'filter/old',
  ])
    assert.equal(normalizeRoute(route), 'today');
  assert.equal(normalizeRoute('pages'), 'notes');
  assert.equal(normalizeRoute('page/old'), 'notes');
  assert.equal(normalizeRoute('history'), 'settings/activity');
});
void test('two tab slots preserve competing recovery drafts and deleted-note recovery creates an independent note', async () => {
  const owner = 'two-tabs',
    note = await create(owner);
  const peer = (await import(
    new URL('../lib/stride/note-drafts.ts?peer', import.meta.url).href
  )) as typeof import('../lib/stride/note-drafts');
  await stageNoteDraft(owner, note, 'First tab', document('first'));
  await peer.stageNoteDraft(owner, note, 'Second tab', document('second'));
  assert.equal((await recoverableNoteDrafts(owner, note.id)).length, 2);
  await flushNoteDraft(owner, note.id);
  await assert.rejects(
    peer.flushNoteDraft(owner, note.id),
    /another tab or device/,
  );
  assert.equal(
    (await peer.recoverableNoteDrafts(owner, note.id))[0].title,
    'Second tab',
  );
  await transact(
    (state) =>
      applyEdits(
        state,
        [{ id: note.id, kind: 'note', data: { _deleted: true } }],
        'Deleted elsewhere',
      ),
    owner,
  );
  await assert.rejects(
    peer.flushNoteDraft(owner, note.id),
    /removed elsewhere/,
  );
  const recovered = await peer.recoverDraftAsNewNote(
    owner,
    (await peer.readNoteDraft(owner, note.id))!,
  );
  const entities = materialize((await load(owner)).fields);
  assert.equal(
    entities.some((entity) => entity.id === note.id),
    false,
  );
  assert.equal(
    (entities.find((entity) => entity.id === recovered) as Note).data.title,
    'Second tab',
  );
  assert.equal(peer.hasUnsavedNoteDrafts(), false);
});
void test('attachment bytes are available offline and unavailable downloads retain a retryable error', async () => {
  const { saveFile } = await import('../lib/stride/storage');
  const { fileURL } = await import('../lib/stride/files');
  const original = globalThis.fetch;
  let attempts = 0;
  try {
    globalThis.fetch = async () => {
      attempts++;
      throw new Error('offline');
    };
    await saveFile(
      'offline-note-image',
      new Blob(['bytes']),
      'offline-note-owner',
      'image.png',
    );
    const url = await fileURL('offline-note-image', 'offline-note-owner');
    assert.ok(url.startsWith('blob:'));
    URL.revokeObjectURL(url);
    assert.equal(attempts, 0);
    await assert.rejects(fileURL('missing', 'guest'), /missing on this device/);
    globalThis.fetch = async () => {
      attempts++;
      return new Response('Missing', { status: 404 });
    };
    await assert.rejects(
      fileURL('missing', 'offline-note-owner'),
      /Reconnect and retry/,
    );
    await assert.rejects(
      fileURL('missing', 'offline-note-owner'),
      /Reconnect and retry/,
    );
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = original;
  }
});
void test('documents emitted by the installed Tiptap table and checklist schema validate', async () => {
  const { getSchema } = await import('@tiptap/core');
  const { default: StarterKit } = await import('@tiptap/starter-kit');
  const { TableKit } = await import('@tiptap/extension-table');
  const { default: TaskList } = await import('@tiptap/extension-task-list');
  const { default: TaskItem } = await import('@tiptap/extension-task-item');
  const schema = getSchema([StarterKit, TableKit, TaskList, TaskItem]);
  const table = schema.nodes.table.create(null, [
    schema.nodes.tableRow.create(null, [
      schema.nodes.tableCell.createAndFill()!,
    ]),
  ]);
  const checklist = schema.nodes.taskList.create(null, [
    schema.nodes.taskItem.createAndFill()!,
  ]);
  const output = schema.nodes.doc.create(null, [checklist, table]).toJSON();
  assert.equal(output.content[1].content[0].content[0].attrs.align, null);
  assert.equal(validNoteDocument(output), true);
  const state = blank();
  applyEdits(
    state,
    [
      {
        id: 'formatted',
        kind: 'note',
        data: { ...noteData(), document: output, text: noteText(output) },
      },
    ],
    'Formatted note',
  );
  assert.equal(materialize(state.fields).length, 1);
});

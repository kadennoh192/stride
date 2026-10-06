import { applyEdits, openDB, transact } from './storage';
import { entityFromFields } from './field-index';
import { noteText } from './notes';
import { uid, type Note, type NoteDocument } from './types';
import { noteData } from './notes';
import type { Edit } from './storage';
export interface NoteDraft {
  owner: string;
  id: string;
  title: string;
  document: NoteDocument;
  baseTitle: string;
  baseDocument: NoteDocument;
  revision: number;
  savedAt: number;
  slot: string;
}
// Separate slots preserve competing edits from independent tabs, including a
// tab which closes while another tab is still editing the same note.
// This module also loads during server rendering. Workers prohibit random
// generation while importing modules, so create the tab identity on first use.
let session: string | undefined;
const sessionId = () => (session ??= crypto.randomUUID());
const memory = new Map<string, NoteDraft>();
const committed = new Map<string, { draft: NoteDraft; at: string }>();
const writes = new Map<string, Promise<void>>();
const saving = new Map<string, Promise<void>>();
const attachments = new Map<string, Set<Promise<void>>>();
const keyOf = (owner: string, id: string) => `${owner}:${id}`;
const changed = () => {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event('stride-note-drafts'));
};
export const peekNoteDraft = (owner: string, id: string) =>
  memory.get(keyOf(owner, id));
export const hasUnsavedNoteDrafts = () =>
  memory.size > 0 || attachments.size > 0;
export async function recoverableNoteDrafts(
  owner: string,
  id?: string,
): Promise<NoteDraft[]> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction('noteDrafts')
      .objectStore('noteDrafts')
      .getAll();
    request.onsuccess = () => {
      const versions = new Map(
        (request.result as NoteDraft[]).map((draft) => [draft.slot, draft]),
      );
      for (const draft of memory.values()) versions.set(draft.slot, draft);
      resolve(
        [...versions.values()]
          .filter((draft) => draft.owner === owner && (!id || draft.id === id))
          .sort((a, b) => b.savedAt - a.savedAt),
      );
    };
    request.onerror = () => reject(request.error);
  });
}
export async function readNoteDraft(owner: string, id: string) {
  const key = keyOf(owner, id);
  if (memory.has(key)) return memory.get(key);
  const draft = (await recoverableNoteDrafts(owner, id))[0];
  if (draft) {
    memory.set(key, { ...draft, slot: `${key}:${sessionId()}` });
    changed();
  }
  return memory.get(key);
}
async function persist(draft: NoteDraft) {
  const database = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('noteDrafts', 'readwrite');
    tx.objectStore('noteDrafts').put(draft, draft.slot);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(
        new Error('Draft storage failed. Keep this tab open and retry saving.'),
      );
  });
}
/** Memory changes synchronously. Failed persistence retains the draft; writes
 * serialize within a tab, and retry always attempts persistence again. */
export function stageNoteDraft(
  owner: string,
  note: Note,
  title: string,
  document: NoteDocument,
): Promise<void> {
  const key = keyOf(owner, note.id),
    previous = memory.get(key),
    last = committed.get(key);
  const base = last && note.data.updatedAt <= last.at ? last.draft : undefined;
  const draft: NoteDraft = {
    owner,
    id: note.id,
    title,
    document: structuredClone(document),
    baseTitle: previous?.baseTitle ?? base?.title ?? note.data.title,
    baseDocument: structuredClone(
      previous?.baseDocument ?? base?.document ?? note.data.document,
    ),
    revision: (previous?.revision || 0) + 1,
    savedAt: Date.now(),
    slot: `${key}:${sessionId()}`,
  };
  memory.set(key, draft);
  changed();
  const write = (writes.get(key) || Promise.resolve())
    .catch(() => {})
    .then(() => persist(draft));
  writes.set(key, write);
  return write;
}
/** Register before starting asynchronous file storage so every navigation and
 * application-update guard waits until its durable node is staged. */
export function trackNoteAttachment(
  owner: string,
  id: string,
  operation: () => Promise<void>,
): Promise<void> {
  const key = keyOf(owner, id),
    pending = attachments.get(key) || new Set<Promise<void>>();
  const promise = Promise.resolve()
    .then(operation)
    .finally(() => {
      pending.delete(promise);
      if (!pending.size) attachments.delete(key);
      changed();
    });
  pending.add(promise);
  attachments.set(key, pending);
  changed();
  return promise;
}
export function flushNoteDraft(
  owner: string,
  id: string,
  overwriteRemote = false,
): Promise<void> {
  const key = keyOf(owner, id);
  if (saving.has(key))
    return saving
      .get(key)!
      .then(() => flushNoteDraft(owner, id, overwriteRemote));
  const operation = (async () => {
    // Uploads do not call flush, and insertion stages before this promise ends.
    while (attachments.has(key)) await Promise.all(attachments.get(key)!);
    while (memory.has(key)) {
      await writes.get(key)?.catch(() => {});
      const draft = memory.get(key)!;
      await persist(draft);
      const at = new Date().toISOString();
      let inverse: Edit[] = [];
      await transact((state) => {
        const note = entityFromFields(state.fields, id);
        if (!note || note.deleted || note.kind !== 'note')
          throw new Error(
            'This note was removed elsewhere. Your draft is retained.',
          );
        const alreadySaved =
          note.data.title === draft.title &&
          JSON.stringify(note.data.document) === JSON.stringify(draft.document);
        if (
          !overwriteRemote &&
          !alreadySaved &&
          (note.data.title !== draft.baseTitle ||
            JSON.stringify(note.data.document) !==
              JSON.stringify(draft.baseDocument))
        )
          throw new Error(
            'This note changed in another tab or device. Your draft is retained. Review it before replacing the remote version.',
          );
        if (!alreadySaved)
          inverse = [
            {
              id,
              kind: 'note',
              data: {
                title: note.data.title,
                document: note.data.document,
                text: note.data.text,
                updatedAt: note.data.updatedAt,
              },
            },
          ];
        if (!alreadySaved)
          applyEdits(
            state,
            [
              {
                id,
                kind: 'note',
                data: {
                  title: draft.title,
                  document: draft.document,
                  text: noteText(draft.document),
                  updatedAt: at,
                },
              },
            ],
            'Edited note',
          );
      }, owner);
      committed.set(key, { draft, at });
      if (inverse.length && typeof window !== 'undefined')
        window.dispatchEvent(
          new CustomEvent('stride-note-saved', { detail: { owner, inverse } }),
        );
      // Clean only identical recovery versions. Competing tab versions survive.
      const database = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction('noteDrafts', 'readwrite');
        const cursor = tx.objectStore('noteDrafts').openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          const value = row.value as NoteDraft;
          if (
            value.owner === owner &&
            value.id === id &&
            value.title === draft.title &&
            JSON.stringify(value.document) === JSON.stringify(draft.document)
          )
            row.delete();
          row.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
      const latest = memory.get(key);
      if (latest?.revision === draft.revision) memory.delete(key);
      else if (latest) {
        latest.baseTitle = draft.title;
        latest.baseDocument = draft.document;
      }
      changed();
    }
  })().finally(() => saving.delete(key));
  saving.set(key, operation);
  return operation;
}
export async function flushAllNoteDrafts() {
  const keys = new Set([...memory.keys(), ...attachments.keys()]);
  await Promise.all(
    [...keys].map((key) => {
      const split = key.indexOf(':');
      return flushNoteDraft(key.slice(0, split), key.slice(split + 1));
    }),
  );
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (hasUnsavedNoteDrafts()) event.preventDefault();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden')
      void flushAllNoteDrafts().catch(() => {});
  });
}

/** Recovery makes a new note, preserving the remote/deleted original. Only the
 * selected recovery version is retired after the new record commits. */
export async function recoverDraftAsNewNote(
  owner: string,
  draft: NoteDraft,
): Promise<string> {
  if (draft.owner !== owner)
    throw new Error('This draft belongs to another account.');
  const id = uid();
  await transact(
    (state) =>
      applyEdits(
        state,
        [
          {
            id,
            kind: 'note',
            data: {
              ...noteData('', draft.title),
              document: draft.document,
              text: noteText(draft.document),
            },
          },
        ],
        'Recovered note draft',
      ),
    owner,
  );
  const database = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('noteDrafts', 'readwrite');
    const request = tx.objectStore('noteDrafts').get(draft.slot);
    request.onsuccess = () => {
      const current = request.result as NoteDraft | undefined;
      if (current?.revision === draft.revision)
        tx.objectStore('noteDrafts').delete(draft.slot);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
  const key = keyOf(owner, draft.id),
    current = memory.get(key);
  if (
    current?.title === draft.title &&
    JSON.stringify(current.document) === JSON.stringify(draft.document)
  )
    memory.delete(key);
  committed.delete(key);
  changed();
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent('stride-note-saved', {
        detail: {
          owner,
          inverse: [{ id, kind: 'note', data: { _deleted: true } }],
        },
      }),
    );
  return id;
}

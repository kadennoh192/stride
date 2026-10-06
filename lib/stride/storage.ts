import { RESET_GENERATION } from './reset-generation';
import {
  draftFields,
  entityRevision,
  putField,
  entityFromFields,
  entitiesFromFields,
} from './field-index';
import { stringValue } from './types';
import {
  type Field,
  type Change,
  type Entity,
  type EntityEdit,
  type Kind,
  type Conflict,
  uid,
  taskData,
  dateKey,
  shiftDate,
} from './types';
import { validateEntity, validateGraph, validField } from './validation';
export const VERSION = 9;
export const SNAPSHOT_VERSION = 4;
export interface Snapshot {
  version: number;
  generation: string;
  fields: Record<string, Field>;
  outbox: Change[];
  history: Change[];
  conflicts: Conflict[];
  clock: number;
  device: string;
  cursor: number;
  owner: string;
  initialized: boolean;
  lastSync: string;
}
export const blank = (owner = 'guest'): Snapshot => ({
  version: SNAPSHOT_VERSION,
  generation: RESET_GENERATION,
  fields: {},
  outbox: [],
  history: [],
  conflicts: [],
  clock: 0,
  device: uid(),
  cursor: 0,
  owner,
  initialized: true,
  lastSync: '',
});
interface StoredMeta extends Omit<
  Snapshot,
  'fields' | 'history' | 'outbox' | 'conflicts'
> {
  revision: number;
}
interface StoredField extends Field {
  owner: string;
  fieldKey: string;
}
interface StoredOperation {
  owner: string;
  id: string;
  change: Change;
  pending: number;
  sequence: number;
}
const SEARCHABLE_KINDS: Kind[] = [
  'task',
  'note',
  'folder',
  'project',
  'habit',
  'course',
  'assignment',
];
const SEARCH_INDEX_CHARACTERS = 4096;
const cached = new Map<string, { snapshot: Snapshot; revision: number }>();
let dbPromise: Promise<IDBDatabase> | undefined;
function metadata(snapshot: Snapshot, revision: number): StoredMeta {
  const {
    fields: _fields,
    history: _history,
    outbox: _outbox,
    conflicts: _conflicts,
    ...meta
  } = snapshot;
  return { ...meta, revision };
}
function createStores(db: IDBDatabase) {
  for (const name of [
    'state',
    'files',
    'recovery',
    'fileQueue',
    'fileDeletes',
    'noteDrafts',
  ])
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
  if (!db.objectStoreNames.contains('records')) {
    const records = db.createObjectStore('records', {
      keyPath: ['owner', 'id'],
    });
    records.createIndex('ownerKind', ['owner', 'kind']);
    records.createIndex('owner', 'owner');
  }
  if (!db.objectStoreNames.contains('meta'))
    db.createObjectStore('meta', { keyPath: 'owner' });
  if (!db.objectStoreNames.contains('fields')) {
    const fields = db.createObjectStore('fields', {
      keyPath: ['owner', 'fieldKey'],
    });
    fields.createIndex('owner', 'owner');
    fields.createIndex('entity', ['owner', 'entity']);
  }
  if (!db.objectStoreNames.contains('operations')) {
    const operations = db.createObjectStore('operations', {
      keyPath: ['owner', 'id'],
    });
    operations.createIndex('owner', 'owner');
    operations.createIndex('pending', ['owner', 'pending']);
  }
  if (!db.objectStoreNames.contains('conflicts')) {
    const conflicts = db.createObjectStore('conflicts', {
      keyPath: ['owner', 'id'],
    });
    conflicts.createIndex('owner', 'owner');
  }
}
export function openDB() {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(
        new Error(
          'Browser storage is unavailable. Enable storage to use Stride.',
        ),
      );
      return;
    }
    const request = indexedDB.open('stride-workspace', VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction!;
      createStores(db);
      const records = tx.objectStore('records');
      if (!records.indexNames.contains('container'))
        records.createIndex('container', ['owner', 'kind', 'container']);
      if (!records.indexNames.contains('due'))
        records.createIndex('due', ['owner', 'kind', 'due']);
      if (!records.indexNames.contains('ownerKindActive'))
        records.createIndex('ownerKindActive', ['owner', 'kind', 'active']);
      if (!records.indexNames.contains('containerActive'))
        records.createIndex('containerActive', [
          'owner',
          'kind',
          'container',
          'active',
        ]);
      if (!records.indexNames.contains('ownerKindActiveId'))
        records.createIndex('ownerKindActiveId', [
          'owner',
          'kind',
          'active',
          'id',
        ]);
      if (!records.indexNames.contains('containerActiveId'))
        records.createIndex('containerActiveId', [
          'owner',
          'kind',
          'container',
          'active',
          'id',
        ]);
      if (!records.indexNames.contains('ownerKindDueActive'))
        records.createIndex('ownerKindDueActive', [
          'owner',
          'kind',
          'active',
          'due',
          'id',
        ]);
      if (!records.indexNames.contains('searchGrams'))
        records.createIndex('searchGrams', 'searchGrams', {
          multiEntry: true,
        });
      if (!records.indexNames.contains('ownerKindSearchOverflow'))
        records.createIndex('ownerKindSearchOverflow', [
          'owner',
          'kind',
          'active',
          'searchOverflow',
        ]);
      // Deliberately bypass all retired migration readers: no recovery copy of
      // the authorized purge may be created, even when upgrading schema one.
      if (!db.objectStoreNames.contains('reset')) db.createObjectStore('reset');
      for (const name of Array.from(db.objectStoreNames))
        if (name !== 'reset') tx.objectStore(name).clear();
      tx.objectStore('reset').put(
        { generation: RESET_GENERATION, completedAt: new Date().toISOString() },
        'workspace',
      );
    };
    request.onsuccess = async () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => {
        request.result.close();
        dbPromise = undefined;
        cached.clear();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('stride-storage-invalidated'));
          // This tab must not reopen the new database with stale in-memory data.
          window.location.reload();
        }
      };
      try {
        await finishDeviceReset(request.result);
        resolve(request.result);
      } catch (error) {
        request.result.close();
        dbPromise = undefined;
        reject(error);
      }
    };
    request.onerror = () => {
      dbPromise = undefined;
      reject(
        new Error(
          'Device storage is unavailable. Enable browser storage to save your workspace.',
        ),
      );
    };
    request.onblocked = () => {
      blocked = true;
      dbPromise = undefined;
      reject(new Error('Close older Stride tabs to upgrade storage.'));
    };
  }));
}
/** Finish device cleanup before exposing any records. The durable marker lives
 * outside normal settings; interrupted cleanup is retried without wiping new data. */
async function finishDeviceReset(database: IDBDatabase) {
  const marker = await new Promise<
    { generation: string; preferencesCleared?: boolean } | undefined
  >((resolve, reject) => {
    const request = database
      .transaction('reset')
      .objectStore('reset')
      .get('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (marker?.generation !== RESET_GENERATION)
    throw new Error('Storage reset marker is missing. Close Stride and retry.');
  if (marker.preferencesCleared) return;
  if (typeof localStorage !== 'undefined') {
    for (const key of Object.keys(localStorage))
      if (key.startsWith('stride-') && key !== 'stride-last-account')
        localStorage.removeItem(key);
  }
  if (typeof sessionStorage !== 'undefined')
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith('stride-')) sessionStorage.removeItem(key);
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager?.getSubscription();
    await subscription?.unsubscribe();
  }
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('reset', 'readwrite');
    tx.objectStore('reset').put(
      { ...marker, preferencesCleared: true },
      'workspace',
    );
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}

export async function localResetStatus() {
  const database = await openDB();
  return new Promise<unknown>((resolve, reject) => {
    const request = database
      .transaction('reset')
      .objectStore('reset')
      .get('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function indexedRecord(owner: string, e: Entity) {
  const searchable = searchableText(e);
  const characters = Array.from(searchable);
  return {
    ...e,
    owner,
    active: e.deleted ? 0 : 1,
    container: stringValue(e.data.folder || e.data.project || ''),
    due: stringValue(e.data.due || ''),
    searchGrams:
      !e.deleted && SEARCHABLE_KINDS.includes(e.kind)
        ? searchTrigrams(characters.slice(0, SEARCH_INDEX_CHARACTERS))
        : [],
    searchOverflow:
      !e.deleted &&
      SEARCHABLE_KINDS.includes(e.kind) &&
      characters.length > SEARCH_INDEX_CHARACTERS
        ? 1
        : 0,
  };
}

function normalizedSearch(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function searchableText(entity: Entity) {
  if (entity.deleted || !SEARCHABLE_KINDS.includes(entity.kind)) return '';
  return normalizedSearch(
    `${stringValue(entity.data.title)} ${stringValue(entity.data.text)} ${stringValue(entity.data.description)}`,
  );
}

function searchTrigrams(value: string | string[]) {
  const characters = typeof value === 'string' ? Array.from(value) : value;
  if (characters.length < 3) return [];
  return [
    ...new Set(
      Array.from({ length: characters.length - 2 }, (_, index) =>
        characters.slice(index, index + 3).join(''),
      ),
    ),
  ];
}

function getSnapshot(
  tx: IDBTransaction,
  owner: string,
  done: (snapshot: Snapshot, revision: number) => void,
) {
  const metaRequest = tx.objectStore('meta').get(owner);
  metaRequest.onsuccess = () => {
    const meta = metaRequest.result as StoredMeta | undefined;
    const cache = cached.get(owner);
    if (meta && cache?.revision === meta.revision) {
      done(cache.snapshot, meta.revision);
      return;
    }
    if (!meta) {
      done(blank(owner), 0);
      return;
    }
    const fieldRequest = tx.objectStore('fields').index('owner').getAll(owner);
    const operationRequest = tx
      .objectStore('operations')
      .index('owner')
      .getAll(owner);
    const conflictRequest = tx
      .objectStore('conflicts')
      .index('owner')
      .getAll(owner);
    let fields: StoredField[] | undefined,
      operations: StoredOperation[] | undefined,
      conflicts: Conflict[] | undefined;
    const finish = () => {
      if (!fields || !operations || !conflicts) return;
      operations.sort(
        (a, b) =>
          a.sequence - b.sequence ||
          a.change.fields[0].stamp.localeCompare(b.change.fields[0].stamp) ||
          a.id.localeCompare(b.id),
      );
      const { revision: _revision, ...snapshotMeta } = meta;
      const snapshot: Snapshot = {
        ...snapshotMeta,
        fields: Object.fromEntries(
          fields.map(({ owner: _owner, fieldKey, ...f }) => [fieldKey, f]),
        ),
        history: operations.map((o) => o.change),
        outbox: operations.filter((o) => o.pending === 1).map((o) => o.change),
        conflicts,
      };
      done(snapshot, meta.revision);
    };
    fieldRequest.onsuccess = () => {
      fields = fieldRequest.result;
      finish();
    };
    operationRequest.onsuccess = () => {
      operations = operationRequest.result;
      finish();
    };
    conflictRequest.onsuccess = () => {
      conflicts = conflictRequest.result;
      finish();
    };
  };
}
const CORE_STORES = ['meta', 'fields', 'operations', 'conflicts', 'records'];
export async function transact(
  fn: (s: Snapshot) => void,
  owner = 'guest',
  recover = false,
  files?: LocalFile[],
  deleteFiles?: string[],
): Promise<Snapshot> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const stores = [
      ...CORE_STORES,
      ...(recover ? ['recovery'] : []),
      ...(recover || files || deleteFiles
        ? ['files', 'fileQueue', 'fileDeletes']
        : []),
    ];
    const tx = db.transaction(stores, 'readwrite');
    let result: Snapshot,
      revision = 0,
      source: Snapshot,
      fieldChanges: Map<string, Field>;
    let reason: unknown;
    getSnapshot(tx, owner, (snapshot, currentRevision) => {
      try {
        source = snapshot;
        if (
          snapshot.version !== SNAPSHOT_VERSION ||
          snapshot.generation !== RESET_GENERATION
        )
          throw new Error('This workspace requires a newer version of Stride.');
        const draft = draftFields(snapshot.fields);
        fieldChanges = draft.changes;
        result = {
          ...snapshot,
          fields: draft.fields,
          outbox: [...snapshot.outbox],
          history: [...snapshot.history],
          conflicts: [...snapshot.conflicts],
        };
        if (recover) {
          const fileRequest = tx.objectStore('files').getAll();
          fileRequest.onsuccess = () =>
            tx.objectStore('recovery').put(
              {
                snapshot,
                files: (fileRequest.result as LocalFile[]).filter(
                  (f) => f.owner === owner,
                ),
              },
              `${owner}:${Date.now()}:${uid()}`,
            );
        }
        fn(result);
        for (const [key, f] of draft.changes)
          tx.objectStore('fields').put({ ...f, owner, fieldKey: key });
        for (const id of new Set(
          [...draft.changes.values()].map((f) => f.entity),
        )) {
          const record = entityFromFields(draft.fields, id);
          if (record)
            tx.objectStore('records').put(indexedRecord(owner, record));
        }
        const oldPending = new Set(snapshot.outbox.map((c) => c.id));
        const pending = new Set(result.outbox.map((c) => c.id));
        const operations = tx.objectStore('operations');
        const appendOnly =
          result.history.length >= snapshot.history.length &&
          snapshot.history.every(
            (change, sequence) => result.history[sequence]?.id === change.id,
          );
        if (!appendOnly)
          throw new Error('Activity history cannot be rewritten in place.');
        for (
          let sequence = snapshot.history.length;
          sequence < result.history.length;
          sequence++
        ) {
          const change = result.history[sequence];
          operations.put({
            owner,
            id: change.id,
            change,
            pending: pending.has(change.id) ? 1 : 0,
            sequence,
          });
        }
        const acknowledged = [...oldPending].filter((id) => !pending.has(id));
        if (acknowledged.length) {
          const acknowledgedIds = new Set(acknowledged);
          for (const [sequence, change] of snapshot.history.entries())
            if (acknowledgedIds.has(change.id))
              operations.put({
                owner,
                id: change.id,
                change,
                pending: 0,
                sequence,
              });
        }
        const conflicts = new Set(result.conflicts.map((c) => c.id));
        const oldConflicts = new Set(snapshot.conflicts.map((c) => c.id));
        for (const c of result.conflicts)
          if (!oldConflicts.has(c.id))
            tx.objectStore('conflicts').put({ ...c, owner });
        for (const c of snapshot.conflicts)
          if (!conflicts.has(c.id))
            tx.objectStore('conflicts').delete([owner, c.id]);
        const changed =
          draft.changes.size > 0 ||
          result.history.length !== snapshot.history.length ||
          result.outbox.length !== snapshot.outbox.length ||
          result.conflicts.length !== snapshot.conflicts.length ||
          JSON.stringify(metadata(result, 0)) !==
            JSON.stringify(metadata(snapshot, 0));
        revision = currentRevision + (changed ? 1 : 0);
        if (changed || !cached.has(owner))
          tx.objectStore('meta').put(metadata(result, revision));
        for (const f of files || []) {
          tx.objectStore('files').put(
            { ...f, owner, uploaded: false, revision: uid() },
            `${owner}:${f.id}`,
          );
          tx.objectStore('fileQueue').put(f.id, `${owner}:${f.id}`);
          tx.objectStore('fileDeletes').delete(`${owner}:${f.id}`);
        }
        for (const id of deleteFiles || []) {
          const key = `${owner}:${id}`;
          tx.objectStore('fileQueue').delete(key);
          tx.objectStore('fileDeletes').put(
            {
              id,
              owner,
              revision: uid(),
              state: 'pending',
              updatedAt: Date.now(),
            } satisfies FileDelete,
            key,
          );
        }
      } catch (e) {
        reason = e;
        tx.abort();
      }
    });
    tx.oncomplete = () => {
      for (const f of fieldChanges.values()) putField(source.fields, f);
      result.fields = source.fields;
      cached.set(owner, { snapshot: result, revision });
      resolve(result);
    };
    tx.onerror = () =>
      reject(
        reason ||
          new Error(
            'Your change could not be saved. Storage may be full. Export a backup before clearing anything.',
          ),
      );
    tx.onabort = () =>
      reject(reason || new Error('Saving was interrupted. Please retry.'));
  });
}
export async function indexedRecords(
  owner: string,
  kind: Kind,
  container?: string,
  limit = 100,
  offset = 0,
): Promise<Entity[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const records = db.transaction('records').objectStore('records');
    const source =
      container === undefined
        ? records.index('ownerKindActive')
        : records.index('containerActive');
    const key =
      container === undefined ? [owner, kind, 1] : [owner, kind, container, 1];
    const request = source.openCursor(IDBKeyRange.only(key));
    const result: Entity[] = [];
    let advanced = offset === 0;
    request.onsuccess = () => {
      const c = request.result;
      if (!c || result.length >= limit) {
        resolve(result);
        return;
      }
      if (!advanced) {
        advanced = true;
        c.advance(offset);
        return;
      }
      result.push(entityFromIndexedRecord(c.value));
      c.continue();
    };
    request.onerror = () => reject(request.error);
  });
}
export async function indexedRecordPage(
  owner: string,
  kind: Kind,
  container?: string,
  limit = 100,
  afterId = '',
): Promise<Entity[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const records = db.transaction('records').objectStore('records');
    const source =
      container === undefined
        ? records.index('ownerKindActiveId')
        : records.index('containerActiveId');
    const prefix =
      container === undefined ? [owner, kind, 1] : [owner, kind, container, 1];
    const lower = [...prefix, afterId];
    const upper = [...prefix, '\uffff'];
    const request = source.openCursor(
      IDBKeyRange.bound(lower, upper, afterId !== '', false),
    );
    const result: Entity[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || result.length >= limit) {
        resolve(result);
        return;
      }
      result.push(entityFromIndexedRecord(cursor.value));
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function entityFromIndexedRecord(value: Record<string, unknown>): Entity {
  const {
    owner: _owner,
    container: _container,
    due: _due,
    active: _active,
    searchGrams: _searchGrams,
    searchOverflow: _searchOverflow,
    ...entity
  } = value;
  return entity as unknown as Entity;
}

/** Searches the durable record index without hydrating the full workspace. */
export async function searchRecords(
  owner: string,
  rawQuery: string,
  limit = 50,
): Promise<Entity[]> {
  const database = await openDB();
  const query = normalizedSearch(rawQuery.slice(0, 1000));
  const maximum = Math.max(1, Math.min(100, Math.floor(limit) || 50));
  const readIndex = (
    index: 'ownerKindActive' | 'searchGrams' | 'ownerKindSearchOverflow',
    key: IDBValidKey,
  ) =>
    new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = database
        .transaction('records')
        .objectStore('records')
        .index(index)
        .getAll(IDBKeyRange.only(key));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  const countIndex = (index: 'searchGrams', key: IDBValidKey) =>
    new Promise<number>((resolve, reject) => {
      const request = database
        .transaction('records')
        .objectStore('records')
        .index(index)
        .count(IDBKeyRange.only(key));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  const validCandidate = (value: Record<string, unknown>) =>
    value.owner === owner &&
    value.active === 1 &&
    SEARCHABLE_KINDS.includes(value.kind as Kind);
  let candidates: Record<string, unknown>[];
  if (Array.from(query).length < 3) {
    candidates = (
      await Promise.all(
        SEARCHABLE_KINDS.map((kind) =>
          readIndex('ownerKindActive', [owner, kind, 1]),
        ),
      )
    ).flat();
  } else {
    const grams = searchTrigrams(query);
    const selectedGrams = [
      grams[0],
      grams[Math.floor(grams.length / 2)],
      grams.at(-1)!,
    ].filter((gram, index, values) => values.indexOf(gram) === index);
    const counts = await Promise.all(
      selectedGrams.map(async (gram) => ({
        gram,
        count: await countIndex('searchGrams', gram),
      })),
    );
    const rarest = counts.reduce((best, candidate) =>
      candidate.count < best.count ? candidate : best,
    );
    const indexed = (
      rarest.count ? await readIndex('searchGrams', rarest.gram) : []
    ).filter(validCandidate);
    const overflow = (
      await Promise.all(
        SEARCHABLE_KINDS.map((kind) =>
          readIndex('ownerKindSearchOverflow', [owner, kind, 1, 1]),
        ),
      )
    ).flat();
    candidates = [
      ...new Map(
        [...indexed, ...overflow]
          .filter(validCandidate)
          .map((value) => [
            `${stringValue(value.kind)}:${stringValue(value.id)}`,
            value,
          ]),
      ).values(),
    ];
  }
  candidates.sort((a, b) => {
    const kind =
      SEARCHABLE_KINDS.indexOf(a.kind as Kind) -
      SEARCHABLE_KINDS.indexOf(b.kind as Kind);
    if (kind) return kind;
    const left = stringValue(a.id),
      right = stringValue(b.id);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const results: Entity[] = [];
  for (const value of candidates) {
    const entity = entityFromIndexedRecord(value);
    if (searchableText(entity).includes(query)) results.push(entity);
    if (results.length >= maximum) break;
  }
  return results;
}

export async function indexedDueRecords(
  owner: string,
  kind: Kind,
  from: string,
  through: string,
  limit = 300,
): Promise<Entity[]> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const index = database
      .transaction('records')
      .objectStore('records')
      .index('ownerKindDueActive');
    const lower = [owner, kind, 1, from, ''];
    const upper = [owner, kind, 1, through, '\uffff'];
    const request = index.openCursor(IDBKeyRange.bound(lower, upper));
    const result: Entity[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || result.length >= limit) {
        resolve(result);
        return;
      }
      result.push(entityFromIndexedRecord(cursor.value));
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

/** A bounded first-screen projection; the full conflict/sync snapshot loads separately. */
export async function startupProjection(
  owner: string,
  project = '',
): Promise<Entity[]> {
  const through = shiftDate(dateKey(), 90);
  const [undated, scheduled, projects, settings, completions, scoped] =
    await Promise.all([
      indexedDueRecords(owner, 'task', '', '', 100),
      indexedDueRecords(owner, 'task', '0000-01-01', through, 300),
      indexedRecordPage(owner, 'project', undefined, 100),
      indexedRecordPage(owner, 'settings', undefined, 1),
      indexedRecordPage(owner, 'completion', undefined, 100),
      project
        ? indexedRecordPage(owner, 'task', project, 300)
        : Promise.resolve([]),
    ]);
  return [
    ...new Map(
      [
        ...undated,
        ...scheduled,
        ...scoped,
        ...projects,
        ...settings,
        ...completions,
      ].map((entity) => [entity.id, entity]),
    ).values(),
  ];
}
export function fieldKey(f: Pick<Field, 'entity' | 'key'>) {
  return `${f.entity}:${f.key}`;
}
export function mergeFields(state: Snapshot, fields: Field[], detect = true) {
  const deletionConflicts = new Set<string>();
  if (detect) {
    const groups = new Map<string, Field[]>();
    for (const field of fields) {
      const group = groups.get(field.entity) || [];
      group.push(field);
      groups.set(field.entity, group);
    }
    for (const [entity, incoming] of groups) {
      const existing = entityFromFields(state.fields, entity);
      if (!existing) continue;
      const deletion = state.fields[`${entity}:_deleted`];
      const revision = entityRevision(state.fields, entity);
      const incomingDeletion = incoming.find((f) => f.key === '_deleted');
      const competing = incoming.find(
        (f) =>
          f.entityBase !== undefined &&
          revision > f.entityBase &&
          f.stamp !== revision,
      );
      if (
        !competing ||
        (!incomingDeletion?.value && !existing.deleted) ||
        incomingDeletion?.value === false
      )
        continue;
      const isDelete = incomingDeletion?.value === true;
      if (isDelete && existing.deleted) continue;
      if (
        !isDelete &&
        !incoming.some(
          (f) =>
            f.key !== '_deleted' &&
            f.stamp !== state.fields[fieldKey(f)]?.stamp,
        )
      )
        continue;
      const local: Field = isDelete
        ? {
            entity,
            kind: existing.kind,
            key: '_deleted',
            value: false,
            stamp: revision,
          }
        : deletion!;
      const remote: Field = isDelete
        ? incomingDeletion!
        : {
            entity,
            kind: existing.kind,
            key: '_deleted',
            value: false,
            stamp: competing.stamp,
            base: competing.entityBase,
          };
      const id = [entity + ':deletion', local.stamp, remote.stamp]
        .sort()
        .join('|');
      if (!state.conflicts.some((c) => c.id === id))
        state.conflicts.push({
          id,
          entity,
          key: '_deleted',
          local,
          remote,
          at: new Date().toISOString(),
        });
      deletionConflicts.add(entity);
    }
  }
  for (const f of fields) {
    if (!validField(f)) throw new Error('Invalid synchronized record');
    const key = fieldKey(f);
    const current = state.fields[key];
    if (current?.kind && current.kind !== f.kind)
      throw new Error('Record type mismatch');
    if (
      detect &&
      !(f.key === '_deleted' && deletionConflicts.has(f.entity)) &&
      f.kind !== 'completion' &&
      !(
        f.kind === 'task' &&
        f.key === 'completedAt' &&
        typeof f.value === 'string' &&
        f.value !== '' &&
        typeof current?.value === 'string' &&
        current.value !== ''
      ) &&
      current &&
      f.stamp !== current.stamp &&
      f.base !== undefined &&
      current.base !== undefined &&
      f.base !== current.stamp &&
      current.base !== f.stamp &&
      JSON.stringify(f.value) !== JSON.stringify(current.value)
    ) {
      const id = [key, current.stamp, f.stamp].sort().join('|');
      if (!state.conflicts.some((c) => c.id === id))
        state.conflicts.push({
          id,
          entity: f.entity,
          key: f.key,
          local: current,
          remote: f,
          at: new Date().toISOString(),
        });
    }
    if (!current || f.stamp > current.stamp) putField(state.fields, f);
    state.clock = Math.max(state.clock, Number(f.stamp.split('-')[0]) || 0);
  }
}
export function materialize(
  fields: Record<string, Field>,
  includeDeleted = false,
): Entity[] {
  return entitiesFromFields(fields, includeDeleted);
}
export type Edit = EntityEdit;
export function applyEdits(s: Snapshot, edits: Edit[], label: string) {
  if (!edits.length) return;
  const combined = new Map<string, Edit>();
  for (const edit of edits) {
    const prior = combined.get(edit.id);
    if (prior && prior.kind !== edit.kind)
      throw new Error('Record type cannot change');
    combined.set(edit.id, {
      ...edit,
      data: { ...prior?.data, ...edit.data },
    } as Edit);
  }
  edits = [...combined.values()];
  const existing = new Map(
    edits.map((e) => [e.id, entityFromFields(s.fields, e.id)]),
  );
  for (const e of edits) {
    const previous = existing.get(e.id);
    if (previous && previous.kind !== e.kind)
      throw new Error('Record type cannot change');
    const next = {
      id: e.id,
      kind: e.kind,
      data: { ...previous?.data, ...e.data },
      deleted:
        e.data._deleted === true ||
        (e.data._deleted === undefined && previous?.deleted),
    };
    validateEntity(next);
    existing.set(e.id, next as Entity);
  }
  const graphRecords = [...existing.values()].filter(
    (entity): entity is Entity => !!entity,
  );
  const changedCourses = new Set(
    edits.filter((edit) => edit.kind === 'course').map((edit) => edit.id),
  );
  if (changedCourses.size)
    for (const entity of entitiesFromFields(s.fields))
      if (
        entity.kind === 'assignment' &&
        changedCourses.has(entity.data.course) &&
        !existing.has(entity.id)
      )
        graphRecords.push(entity);
  validateGraph(
    graphRecords,
    (id) => existing.get(id) || entityFromFields(s.fields, id),
  );
  const revisions = new Map(
    edits.map((e) => [e.id, entityRevision(s.fields, e.id)]),
  );
  s.clock = Math.max(Date.now(), s.clock + 1);
  const stamp = `${stringValue(s.clock).padStart(15, '0')}-${s.device}`;
  const fields = edits.flatMap((e) =>
    Object.entries(e.data)
      .filter(
        ([key, value]) =>
          JSON.stringify(s.fields[`${e.id}:${key}`]?.value) !==
          JSON.stringify(value),
      )
      .map(([key, value]) => ({
        entity: e.id,
        kind: e.kind,
        key,
        value,
        stamp,
        base: s.fields[`${e.id}:${key}`]?.stamp || '',
        entityBase: revisions.get(e.id) || '',
      })),
  );
  if (!fields.length) return;
  const grouped = new Map<string, Field[]>();
  for (const f of fields) {
    const group = grouped.get(f.entity) || [];
    group.push(f);
    grouped.set(f.entity, group);
  }
  let pending: Field[] = [];
  const flush = () => {
    if (!pending.length) return;
    const change: Change = {
      id: uid(),
      fields: pending,
      label,
      at: new Date().toISOString(),
    };
    mergeFields(s, pending, false);
    s.outbox.push(change);
    s.history.push(change);
    pending = [];
  };
  for (const group of grouped.values()) {
    if (group.length > 1000)
      throw new Error('A record cannot exceed 1,000 fields');
    if (pending.length + group.length > 500) flush();
    pending.push(...group);
  }
  flush();
  return fields;
}
export async function load(owner = 'guest') {
  return transact(() => {}, owner);
}
export async function addStarter(owner = 'guest') {
  return transact((s) => {
    applyEdits(
      s,
      [
        {
          id: uid(),
          kind: 'task',
          data: taskData('Plan your week', { tags: ['planning'], priority: 2 }),
        },
        {
          id: uid(),
          kind: 'task',
          data: taskData('Make time for a personal project'),
        },
      ],
      'Added optional starter tasks',
    );
  }, owner);
}
export interface LocalFile {
  revision?: string;
  id: string;
  blob: Blob;
  hash: string;
  name: string;
  uploaded: boolean;
  owner: string;
}
export interface FileDelete {
  revision: string;
  id: string;
  owner: string;
  state: 'pending' | 'complete';
  updatedAt: number;
}
export async function hashBlob(blob: Blob) {
  const bytes = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function saveFile(
  id: string,
  blob: Blob,
  owner = 'guest',
  name = 'attachment',
  uploaded = false,
) {
  if (blob.size > 10_000_000)
    throw new Error('Attachments are limited to 10 MB each.');
  const hash = await hashBlob(blob);
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      ['files', 'fileQueue', 'fileDeletes'],
      'readwrite',
    );
    tx.objectStore('files').put(
      { id, blob, hash, name, uploaded, owner, revision: uid() },
      `${owner}:${id}`,
    );
    if (!uploaded) tx.objectStore('fileQueue').put(id, `${owner}:${id}`);
    else tx.objectStore('fileQueue').delete(`${owner}:${id}`);
    tx.objectStore('fileDeletes').delete(`${owner}:${id}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('Unable to store attachment.'));
  });
}
export async function pendingFileDeletes(owner: string) {
  const db = await openDB();
  return new Promise<FileDelete[]>((resolve, reject) => {
    const result: FileDelete[] = [];
    const request = db
      .transaction('fileDeletes')
      .objectStore('fileDeletes')
      .openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(result);
        return;
      }
      const value = cursor.value as FileDelete;
      if (value.owner === owner && value.state === 'pending')
        result.push(value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}
export async function acknowledgeFileDelete(original: FileDelete) {
  const db = await openDB();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(
      ['files', 'fileQueue', 'fileDeletes'],
      'readwrite',
    );
    const key = `${original.owner}:${original.id}`;
    let unchanged = false;
    const request = tx.objectStore('fileDeletes').get(key);
    request.onsuccess = () => {
      const current = request.result as FileDelete | undefined;
      if (
        !current ||
        current.state !== 'pending' ||
        current.revision !== original.revision
      )
        return;
      unchanged = true;
      tx.objectStore('files').delete(key);
      tx.objectStore('fileQueue').delete(key);
      tx.objectStore('fileDeletes').put(
        { ...current, state: 'complete', updatedAt: Date.now() },
        key,
      );
    };
    tx.oncomplete = () => resolve(unchanged);
    tx.onabort = tx.onerror = () =>
      reject(
        new Error(
          'Cloud removal succeeded, but local cleanup will retry safely.',
        ),
      );
  });
}
/** A restore supersedes a queued deletion and makes the retained bytes uploadable again. */
export async function cancelFileDelete(original: FileDelete) {
  const db = await openDB();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(
      ['files', 'fileQueue', 'fileDeletes'],
      'readwrite',
    );
    const key = `${original.owner}:${original.id}`;
    let restored = false;
    const deletionRequest = tx.objectStore('fileDeletes').get(key);
    deletionRequest.onsuccess = () => {
      const current = deletionRequest.result as FileDelete | undefined;
      if (
        !current ||
        current.state !== 'pending' ||
        current.revision !== original.revision
      )
        return;
      const fileRequest = tx.objectStore('files').get(key);
      fileRequest.onsuccess = () => {
        const file = fileRequest.result as LocalFile | undefined;
        if (!file) return;
        restored = true;
        tx.objectStore('files').put({ ...file, uploaded: false }, key);
        tx.objectStore('fileQueue').put(file.id, key);
        tx.objectStore('fileDeletes').delete(key);
      };
    };
    tx.oncomplete = () => resolve(restored);
    tx.onabort = tx.onerror = () =>
      reject(
        new Error(
          'The restored attachment is safe on this device, but its upload could not be queued. Please retry.',
        ),
      );
  });
}
export async function getLocalFile(
  id: string,
  owner = 'guest',
): Promise<LocalFile | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db
      .transaction('files')
      .objectStore('files')
      .get(`${owner}:${id}`);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function getFile(id: string, owner = 'guest') {
  return (await getLocalFile(id, owner))?.blob;
}
export async function allFiles(owner = 'guest') {
  const db = await openDB();
  return new Promise<LocalFile[]>((resolve, reject) => {
    const result: LocalFile[] = [];
    const r = db.transaction('files').objectStore('files').openCursor();
    r.onsuccess = () => {
      const c = r.result;
      if (c) {
        if (stringValue(c.key).startsWith(`${owner}:`)) result.push(c.value);
        c.continue();
      } else resolve(result);
    };
    r.onerror = () => reject(r.error);
  });
}
export async function restoreSnapshot(
  snapshot: Snapshot,
  files: LocalFile[],
  owner: string,
) {
  if (
    snapshot.version !== SNAPSHOT_VERSION ||
    snapshot.generation !== RESET_GENERATION
  )
    throw new Error(
      'This backup predates the permanent workspace reset and is incompatible.',
    );
  await transact(
    (current) => {
      const imported = materialize(snapshot.fields, true);
      const importedIds = new Set(imported.map((e) => e.id));
      const edits: Edit[] = materialize(current.fields, true)
        .filter((e) => !importedIds.has(e.id))
        .map(
          (e) => ({ id: e.id, kind: e.kind, data: { _deleted: true } }) as Edit,
        );
      for (const e of imported) {
        const previous = entityFromFields(current.fields, e.id);
        const cleared = Object.fromEntries(
          Object.keys(previous?.data || {})
            .filter((key) => !(key in e.data))
            .map((key) => [key, null]),
        );
        edits.push({
          id: e.id,
          kind: e.kind,
          data: { ...cleared, ...e.data, _deleted: !!e.deleted },
        } as Edit);
      }
      for (const file of files)
        edits.push({
          id: `filePurge_${file.id}`,
          kind: 'fileTombstone',
          data: { attachment: '', _deleted: true },
        });
      applyEdits(current, edits, 'Restored backup');
      const known = new Set(current.history.map((c) => c.id));
      current.history.push(...snapshot.history.filter((c) => !known.has(c.id)));
      current.conflicts = snapshot.conflicts || [];
    },
    owner,
    true,
    files,
  );
}

export async function listRecovery(
  owner: string,
): Promise<{ key: string; snapshot: Snapshot; files: LocalFile[] }[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const result: { key: string; snapshot: Snapshot; files: LocalFile[] }[] =
      [];
    const req = db.transaction('recovery').objectStore('recovery').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        if (stringValue(c.key).startsWith(owner + ':'))
          result.push({
            key: stringValue(c.key),
            snapshot: c.value.snapshot || c.value,
            files: c.value.files || [],
          });
        c.continue();
      } else resolve(result.reverse());
    };
    req.onerror = () => reject(req.error);
  });
}

/** Release the connection when the app is disposed or a newer storage version is installed. */
export async function closeStorage() {
  const connection = dbPromise;
  dbPromise = undefined;
  cached.clear();
  (await connection)?.close();
}

/** Capture records and attachment bytes from one read transaction, independent of later edits. */
export async function captureWorkspace(
  owner: string,
): Promise<{ snapshot: Snapshot; files: LocalFile[] }> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...CORE_STORES, 'files'], 'readonly');
    let snapshot: Snapshot;
    let files: LocalFile[];
    const fileRequest = tx.objectStore('files').getAll();
    fileRequest.onsuccess = () => {
      files = (fileRequest.result as LocalFile[]).filter(
        (f) => f.owner === owner,
      );
    };
    getSnapshot(tx, owner, (state) => {
      snapshot = structuredClone(state);
    });
    tx.oncomplete = () => resolve({ snapshot, files });
    tx.onabort = tx.onerror = () =>
      reject(new Error('Could not capture a consistent backup. Please retry.'));
  });
}

export interface UploadProgress {
  id: string;
  hash: string;
  confirmedBytes: number;
  totalBytes: number;
  updatedAt: number;
}
/** Guard transfer acknowledgments against files replaced by a concurrent restore. */
export async function acknowledgeFileTransfer(
  original: LocalFile,
  hash: string,
  confirmedBytes: number,
  complete = false,
): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['files', 'fileQueue'], 'readwrite'),
      key = `${original.owner}:${original.id}`;
    let unchanged = false;
    const request = tx.objectStore('files').get(key);
    request.onsuccess = () => {
      const current = request.result as LocalFile | undefined;
      if (
        !current ||
        current.revision !== original.revision ||
        current.hash !== original.hash
      )
        return;
      unchanged = true;
      if (complete) {
        tx.objectStore('files').put({ ...current, hash, uploaded: true }, key);
        tx.objectStore('fileQueue').delete(key);
      } else
        tx.objectStore('fileQueue').put(
          {
            id: original.id,
            hash,
            confirmedBytes,
            totalBytes: original.blob.size,
            updatedAt: Date.now(),
          } satisfies UploadProgress,
          key,
        );
    };
    tx.oncomplete = () => resolve(unchanged);
    tx.onabort = tx.onerror = () =>
      reject(
        new Error(
          'Upload progress could not be saved. Your attachment remains on this device.',
        ),
      );
  });
}
export async function uploadProgress(
  id: string,
  owner: string,
): Promise<UploadProgress | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db
      .transaction('fileQueue')
      .objectStore('fileQueue')
      .get(`${owner}:${id}`);
    r.onsuccess = () =>
      resolve(typeof r.result === 'object' ? r.result : undefined);
    r.onerror = () => reject(r.error);
  });
}

/** A download may fill a missing cache entry, but never replace bytes saved while it was in flight. */
export async function cacheDownloadedFile(
  id: string,
  blob: Blob,
  owner: string,
  name = 'attachment',
): Promise<LocalFile> {
  if (blob.size > 10_000_000)
    throw new Error('Attachments are limited to 10 MB each.');
  const hash = await hashBlob(blob),
    db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite'),
      files = tx.objectStore('files'),
      key = `${owner}:${id}`;
    let result: LocalFile;
    const request = files.get(key);
    request.onsuccess = () => {
      result = (request.result as LocalFile) || {
        id,
        blob,
        hash,
        owner,
        name,
        uploaded: true,
        revision: uid(),
      };
      if (!request.result) files.put(result, key);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () =>
      reject(
        new Error(
          'Unable to cache the attachment. Your existing files were not changed.',
        ),
      );
  });
}

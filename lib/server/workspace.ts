import { workspaceReady } from './reset';
import { flushScheduleQueue } from './reminders';
import { db } from './bindings';
import {
  applyEdits,
  blank,
  materialize,
  mergeFields,
  type Edit,
  type Snapshot,
} from '@/lib/stride/storage';
import type { Change, Entity, Field } from '@/lib/stride/types';

type StoredField = Omit<Field, 'value'> & { value: string };

export async function loadCloudWorkspace(owner: string): Promise<Snapshot> {
  const rows = await db()
    .prepare(
      'SELECT entity,kind,key,value,stamp FROM fields WHERE owner=? ORDER BY entity,key',
    )
    .bind(owner)
    .all<StoredField>();
  const state = blank(owner);
  mergeFields(
    state,
    rows.results.map((field) => ({
      ...field,
      value: JSON.parse(field.value) as unknown,
    })),
    false,
  );
  return state;
}

export async function cloudEntities(owner: string): Promise<Entity[]> {
  return materialize((await loadCloudWorkspace(owner)).fields);
}

/**
 * Apply a small server-originated edit through the same field/change protocol
 * used by browsers so every connected device observes and merges it normally.
 */
export async function saveCloudEdits(
  owner: string,
  edits: Edit[],
  label: string,
): Promise<Change[]> {
  if (!(await workspaceReady(owner)))
    throw new Error('Workspace reset is required.');
  const state = await loadCloudWorkspace(owner);
  applyEdits(state, edits, label);
  const database = db();
  for (const change of state.outbox) {
    const statements = change.fields.map((field) =>
      database
        .prepare(
          'INSERT INTO fields (owner,entity,kind,key,value,stamp) VALUES (?,?,?,?,?,?) ON CONFLICT(owner,entity,key) DO UPDATE SET value=excluded.value,stamp=excluded.stamp WHERE excluded.stamp > fields.stamp',
        )
        .bind(
          owner,
          field.entity,
          field.kind,
          field.key,
          JSON.stringify(field.value),
          field.stamp,
        ),
    );
    statements.push(
      database
        .prepare('INSERT INTO changes (owner,id,payload) VALUES (?,?,?)')
        .bind(owner, change.id, JSON.stringify(change)),
      database
        .prepare('INSERT INTO dedup (owner,id) VALUES (?,?)')
        .bind(owner, change.id),
    );
    for (const entity of new Set(change.fields.map((field) => field.entity)))
      statements.push(
        database
          .prepare(
            'INSERT INTO reminder_schedule_queue (owner,entity,revision) VALUES (?,?,?) ON CONFLICT(owner,entity) DO UPDATE SET revision=excluded.revision',
          )
          .bind(owner, entity, change.id),
      );
    await database.batch(statements);
  }
  await flushScheduleQueue(owner);
  return state.outbox;
}

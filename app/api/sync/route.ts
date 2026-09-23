import { flushScheduleQueue } from '@/lib/server/reminders';
import { authorize } from '@/lib/server/auth';
import { db, sameOrigin } from '@/lib/server/bindings';
import {
  validChange,
  validateEntity,
  ValidationError,
} from '@/lib/stride/validation';
import { materialize, mergeFields, blank } from '@/lib/stride/storage';
import type { Change, Field } from '@/lib/stride/types';
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 });
  const user = await authorize(request);
  if (user instanceof Response) return user;
  if (!user)
    return Response.json({ error: 'Sign in to sync' }, { status: 401 });
  try {
    if (Number(request.headers.get('content-length')) > 2000000)
      return Response.json({ error: 'Sync batch too large' }, { status: 413 });
    const text = await request.text();
    if (text.length > 2000000)
      return Response.json({ error: 'Sync batch too large' }, { status: 413 });
    const input = JSON.parse(text);
    if (
      ![2, 3].includes(input.version) ||
      !Array.isArray(input.changes) ||
      input.changes.length > 10 ||
      !input.changes.every(validChange) ||
      !Number.isSafeInteger(input.cursor) ||
      input.cursor < 0
    )
      return Response.json({ error: 'Invalid sync payload' }, { status: 400 });
    if (input.owner !== user.id)
      return Response.json(
        { error: 'This workspace belongs to a different account.' },
        { status: 409 },
      );
    const database = db();
    if (input.version === 2) {
      const newer = await database
        .prepare(
          "SELECT kind FROM fields WHERE owner=? AND kind IN ('course','assignment','alarm','showerSession','checkIn','streakDay') LIMIT 1",
        )
        .bind(user.id)
        .first();
      if (
        newer ||
        (input.changes as Change[]).some((change) =>
          change.fields.some((field) =>
            [
              'course',
              'assignment',
              'alarm',
              'showerSession',
              'checkIn',
              'streakDay',
            ].includes(field.kind),
          ),
        )
      )
        return Response.json(
          {
            error:
              'This workspace requires a newer version of Stride before syncing.',
            upgradeRequired: true,
          },
          { status: 426, headers: { 'Cache-Control': 'no-store' } },
        );
    }
    for (const change of input.changes as Change[]) {
      const seen = await database
        .prepare('SELECT id FROM dedup WHERE owner = ? AND id = ?')
        .bind(user.id, change.id)
        .first();
      if (seen) {
        const saved = await database
          .prepare('SELECT payload FROM changes WHERE owner=? AND id=?')
          .bind(user.id, change.id)
          .first<{ payload: string }>();
        if (!saved || saved.payload !== JSON.stringify(change))
          return Response.json(
            { error: 'Operation identifier was reused for different content.' },
            { status: 409 },
          );
        continue;
      }
      const entities = [...new Set(change.fields.map((f) => f.entity))];
      for (const entity of entities) {
        const old = await database
          .prepare(
            'SELECT entity,kind,key,value,stamp FROM fields WHERE owner=? AND entity=?',
          )
          .bind(user.id, entity)
          .all<{
            entity: string;
            kind: Field['kind'];
            key: string;
            value: string;
            stamp: string;
          }>();
        const state = blank(user.id);
        mergeFields(
          state,
          old.results.map((f) => ({ ...f, value: JSON.parse(f.value) })),
          false,
        );
        mergeFields(
          state,
          change.fields.filter((f) => f.entity === entity),
          false,
        );
        for (const record of materialize(state.fields, true))
          validateEntity(record);
      }
      const statements = change.fields.map((f) =>
        database
          .prepare(
            'INSERT INTO fields (owner,entity,kind,key,value,stamp) VALUES (?,?,?,?,?,?) ON CONFLICT(owner,entity,key) DO UPDATE SET value=excluded.value,stamp=excluded.stamp WHERE excluded.stamp > fields.stamp',
          )
          .bind(
            user.id,
            f.entity,
            f.kind,
            f.key,
            JSON.stringify(f.value),
            f.stamp,
          ),
      );
      statements.push(
        database
          .prepare(
            'INSERT INTO changes (owner,id,payload) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM dedup WHERE owner=? AND id=?)',
          )
          .bind(user.id, change.id, JSON.stringify(change), user.id, change.id),
      );
      statements.push(
        database
          .prepare('INSERT OR IGNORE INTO dedup (owner,id) VALUES (?,?)')
          .bind(user.id, change.id),
      );
      for (const entity of entities)
        statements.push(
          database
            .prepare(
              'INSERT INTO reminder_schedule_queue (owner,entity,revision) VALUES (?,?,?) ON CONFLICT(owner,entity) DO UPDATE SET revision=excluded.revision',
            )
            .bind(user.id, entity, change.id),
        );
      await database.batch(statements);
    }
    await flushScheduleQueue(user.id);
    const result = await database
      .prepare(
        'SELECT seq,payload FROM changes WHERE owner=? AND seq>? ORDER BY seq LIMIT 100',
      )
      .bind(user.id, input.cursor)
      .all<{ seq: number; payload: string }>();
    const history = result.results.map((r) => JSON.parse(r.payload) as Change);
    if (
      input.version === 2 &&
      history.some((change) =>
        change.fields.some((field) =>
          [
            'course',
            'assignment',
            'alarm',
            'showerSession',
            'checkIn',
            'streakDay',
          ].includes(field.kind),
        ),
      )
    )
      return Response.json(
        {
          error:
            'This workspace requires a newer version of Stride before syncing.',
          upgradeRequired: true,
        },
        { status: 426, headers: { 'Cache-Control': 'no-store' } },
      );
    return Response.json(
      {
        version: input.version,
        owner: user.id,
        acknowledged: input.changes.map((c: Change) => c.id),
        fields: history.flatMap((c) => c.fields),
        history,
        cursor: result.results.at(-1)?.seq ?? input.cursor,
        more: result.results.length === 100,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error && /Invalid|title|timezone|Record/.test(e.message)
            ? e.message
            : 'Sync is temporarily unavailable. Changes remain saved on this device.',
      },
      { status: e instanceof ValidationError ? 400 : 503 },
    );
  }
}

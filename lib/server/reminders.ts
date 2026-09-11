import { stringValue } from '@/lib/stride/types';
import { env } from 'cloudflare:workers';
import {
  buildPushPayload,
  type PushSubscription as WebSubscription,
} from '@block65/webcrypto-web-push';
import { db } from './bindings';
import {
  dateKey,
  shiftDate,
  type Entity,
  type Field,
  type Task,
} from '../stride/types';
import { zonedInstant } from '../stride/domain';
import { materialize } from '../stride/storage';
export function pushConfig() {
  const e = env as unknown as Record<string, string>;
  return {
    publicKey: e.VAPID_PUBLIC_KEY || '',
    privateKey: e.VAPID_PRIVATE_KEY || '',
    subject: e.VAPID_SUBJECT || '',
    secret: e.REMINDER_DISPATCH_SECRET || '',
  };
}
export function pushConfigured() {
  const c = pushConfig();
  return !!(c.publicKey && c.privateKey && c.subject && c.secret);
}
export async function serverEntity(
  owner: string,
  id: string,
): Promise<Entity | undefined> {
  const rows = await db()
    .prepare(
      'SELECT entity,kind,key,value,stamp FROM fields WHERE owner=? AND entity=?',
    )
    .bind(owner, id)
    .all<{
      entity: string;
      kind: Field['kind'];
      key: string;
      value: string;
      stamp: string;
    }>();
  return materialize(
    Object.fromEntries(
      rows.results.map((f) => [
        `${f.entity}:${f.key}`,
        { ...f, value: JSON.parse(f.value) },
      ]),
    ),
    true,
  )[0];
}
export async function hash(text: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
export async function scheduleEntity(owner: string, id: string) {
  const entity = await serverEntity(owner, id);
  if (!entity || !['task', 'habit', 'settings'].includes(entity.kind)) return;
  const database = db();
  if (entity.deleted || entity.data.completedAt) {
    await database
      .prepare(
        "UPDATE reminder_jobs SET state='cancelled' WHERE owner=? AND entity=? AND state IN ('pending','sending')",
      )
      .bind(owner, id)
      .run();
    return;
  }
  const settings = await serverEntity(owner, 'settings');
  const zone = stringValue(
    entity.data.timezone || settings?.data.timezone || 'UTC',
  );
  const times: number[] = [];
  const now = Date.now();
  if (entity.kind === 'task') {
    const t = entity as Task;
    for (const reminder of t.data.reminders || []) {
      if (reminder.startsWith('daily:')) {
        for (let i = 0; i < 32; i++)
          times.push(
            zonedInstant(
              shiftDate(dateKey(new Date(), zone), i),
              reminder.slice(6),
              zone,
            ),
          );
      } else if (reminder === 'due') {
        if (t.data.due && t.data.time)
          times.push(zonedInstant(t.data.due, t.data.time, zone));
      } else if (reminder.startsWith('before:')) {
        if (t.data.due && t.data.time)
          times.push(
            zonedInstant(t.data.due, t.data.time, zone) -
              Number(reminder.slice(7)) * 60000,
          );
      } else times.push(Date.parse(reminder));
    }
  } else if (entity.kind === 'habit' && entity.data.reminder) {
    for (let i = 0; i < 32; i++) {
      const d = shiftDate(dateKey(new Date(), zone), i);
      if (
        ((entity.data.days as number[]) || [0, 1, 2, 3, 4, 5, 6]).includes(
          new Date(d + 'T12:00Z').getUTCDay(),
        )
      )
        times.push(zonedInstant(d, stringValue(entity.data.reminder), zone));
    }
  } else if (entity.kind === 'settings') {
    const timer = entity.data.activeTimer as
      | { running?: boolean; end?: number }
      | undefined;
    if (timer?.running && timer.end) times.push(timer.end);
  }
  const jobs = await Promise.all(
    [...new Set(times)]
      .filter(
        (t) =>
          Number.isFinite(t) &&
          t > now - 86400000 &&
          t > Number(entity.data.reminderAcknowledgedAt || 0),
      )
      .slice(0, 64)
      .map(async (due) => ({ id: await hash(`${owner}:${id}:${due}`), due })),
  );
  const live = await database
    .prepare(
      "SELECT id FROM reminder_jobs WHERE owner=? AND entity=? AND state IN ('pending','sending')",
    )
    .bind(owner, id)
    .all<{ id: string }>();
  const statements = live.results
    .filter((j) => !jobs.some((k) => k.id === j.id))
    .map((j) =>
      database
        .prepare("UPDATE reminder_jobs SET state='cancelled' WHERE id=?")
        .bind(j.id),
    );
  for (const job of jobs.filter((job) => job.due > now - 300000))
    statements.push(
      database
        .prepare(
          'INSERT INTO reminder_jobs (id,owner,entity,due,original_due,repeat_minutes) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
        )
        .bind(
          job.id,
          owner,
          id,
          job.due,
          job.due,
          entity.kind === 'task'
            ? Math.max(0, Number(entity.data.repeatMinutes) || 0)
            : 0,
        ),
    );
  if (statements.length) await database.batch(statements);
}
export function validEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === '443') &&
      (u.hostname === 'web.push.apple.com' ||
        u.hostname === 'fcm.googleapis.com' ||
        u.hostname === 'updates.push.services.mozilla.com' ||
        u.hostname.endsWith('.notify.windows.com'))
    );
  } catch {
    return false;
  }
}
export async function sendPush(
  subscription: WebSubscription,
  title: string,
  body: string,
  url: string,
  tag: string,
) {
  if (!validEndpoint(subscription.endpoint))
    throw new Error('Unsupported push endpoint');
  const config = pushConfig();
  const payload = await buildPushPayload(
    { data: JSON.stringify({ title, body, url, tag }), options: { ttl: 300 } },
    subscription,
    {
      subject: config.subject,
      publicKey: config.publicKey,
      privateKey: config.privateKey,
    },
  );
  return fetch(subscription.endpoint, {
    ...payload,
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
  });
}
export async function verifyDispatch(request: Request, body: string) {
  const config = pushConfig();
  const timestamp = request.headers.get('X-Stride-Time') || '';
  const nonce = request.headers.get('X-Stride-Nonce') || '';
  const signature = request.headers.get('X-Stride-Signature') || '';
  if (
    !config.secret ||
    Math.abs(Date.now() - Number(timestamp)) > 120000 ||
    !/^\d{13}$/.test(timestamp) ||
    !/^[-\w]{16,100}$/.test(nonce) ||
    !/^([a-f\d]{2}){32}$/.test(signature)
  )
    return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(config.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const sig = Uint8Array.from(signature.match(/../g)!, (n) => parseInt(n, 16));
  if (
    !(await crypto.subtle.verify(
      'HMAC',
      key,
      sig,
      new TextEncoder().encode(`${timestamp}.${nonce}.${body}`),
    ))
  )
    return false;
  try {
    await db()
      .prepare('INSERT INTO dispatch_nonces (nonce,created) VALUES (?,?)')
      .bind(nonce, Date.now())
      .run();
    return true;
  } catch {
    return false;
  }
}

/** Scheduling intent commits with the sync operation; a failed scheduler write stays queued. */
export async function flushScheduleQueue(owner?: string) {
  const database = db();
  const query = owner
    ? database
        .prepare(
          'SELECT owner,entity,revision FROM reminder_schedule_queue WHERE owner=? LIMIT 50',
        )
        .bind(owner)
    : database.prepare(
        'SELECT owner,entity,revision FROM reminder_schedule_queue LIMIT 50',
      );
  const pending = await query.all<{
    owner: string;
    entity: string;
    revision: string;
  }>();
  for (const item of pending.results) {
    try {
      await scheduleEntity(item.owner, item.entity);
      await database
        .prepare(
          'DELETE FROM reminder_schedule_queue WHERE owner=? AND entity=? AND revision=?',
        )
        .bind(item.owner, item.entity, item.revision)
        .run();
    } catch {
      /* Durable intent remains for the next scheduled dispatch or foreground sync. */
    }
  }
}

import { db } from '@/lib/server/bindings';
import { workspaceReady } from '@/lib/server/reset';
import { RESET_GENERATION } from '@/lib/stride/reset-generation';
import {
  pushConfigured,
  flushScheduleQueue,
  verifyDispatch,
  serverEntity,
  sendPush,
} from '@/lib/server/reminders';
import { dateKey, shiftDate, stringValue } from '@/lib/stride/types';
import { habitLogId } from '@/lib/stride/habits';
import { zonedInstant } from '@/lib/stride/domain';
import { inQuietHours } from '@/lib/stride/alarms';
import type { PushSubscription as WebSubscription } from '@block65/webcrypto-web-push';
export async function POST(request: Request) {
  if (!pushConfigured())
    return Response.json(
      { error: 'Reminders not configured' },
      { status: 503 },
    );
  const body = await request.text();
  if (body.length > 1000 || !(await verifyDispatch(request, body)))
    return Response.json(
      { error: 'Invalid dispatch signature' },
      { status: 403 },
    );
  const database = db();
  const now = Date.now();
  await flushScheduleQueue();
  await database
    .prepare('DELETE FROM dispatch_nonces WHERE created < ?')
    .bind(now - 600000)
    .run();
  await database
    .prepare(
      "UPDATE reminder_jobs SET state='pending',lease=0 WHERE state='sending' AND lease<?",
    )
    .bind(now)
    .run();
  const claimed = await database
    .prepare(
      "UPDATE reminder_jobs SET state='sending',lease=? WHERE id IN (SELECT id FROM reminder_jobs WHERE state='pending' AND due<=? AND owner IN (SELECT owner FROM workspace_resets WHERE generation=? AND phase='complete') ORDER BY due LIMIT 25) RETURNING *",
    )
    .bind(now + 120000, now, RESET_GENERATION)
    .all<{
      id: string;
      owner: string;
      entity: string;
      due: number;
      original_due: number;
      attempts: number;
      round: number;
      repeat_minutes: number;
    }>();
  let sent = 0,
    failed = 0;
  for (const job of claimed.results) {
    try {
      if (!(await workspaceReady(job.owner))) continue;
      const entity = await serverEntity(job.owner, job.entity);
      if (
        !entity ||
        entity.deleted ||
        entity.data.completedAt ||
        (entity.kind === 'assignment' && entity.data.status === 'Done') ||
        (entity.kind === 'alarm' &&
          (!entity.data.enabled ||
            entity.data.acknowledgedOccurrence ===
              new Date(job.original_due).toISOString())) ||
        job.original_due <= Number(entity.data.reminderAcknowledgedAt || 0) ||
        now - job.due > 3600000 ||
        now - job.original_due > 86400000
      ) {
        await database
          .prepare(
            "UPDATE reminder_jobs SET state='expired',lease=0 WHERE id=?",
          )
          .bind(job.id)
          .run();
        continue;
      }
      if (
        entity.kind === 'alarm' &&
        entity.data.linkedKind &&
        entity.data.linkedId
      ) {
        const linked = await serverEntity(
          job.owner,
          stringValue(entity.data.linkedId),
        );
        if (
          !linked ||
          linked.deleted ||
          linked.data.completedAt ||
          linked.data.status === 'Done'
        ) {
          await database
            .prepare(
              "UPDATE reminder_jobs SET state='cancelled',lease=0 WHERE id=?",
            )
            .bind(job.id)
            .run();
          continue;
        }
      }
      const settings = await serverEntity(job.owner, 'settings');
      const zone = stringValue(
        entity.data.timezone || settings?.data.timezone || 'UTC',
      );
      const wall = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(now);
      const quietStart = stringValue(settings?.data.quietStart || '22:00'),
        quietEnd = stringValue(settings?.data.quietEnd || '07:00');
      const quiet = inQuietHours(wall, quietStart, quietEnd);
      if (quiet && (entity.kind !== 'alarm' || entity.data.respectQuietHours)) {
        const day = dateKey(new Date(now), zone);
        const next = zonedInstant(
          wall >= quietEnd ? shiftDate(day, 1) : day,
          quietEnd,
          zone,
        );
        await database
          .prepare(
            "UPDATE reminder_jobs SET state='pending',lease=0,due=? WHERE id=?",
          )
          .bind(next, job.id)
          .run();
        continue;
      }
      if (entity.kind === 'habit') {
        const day = dateKey(new Date(job.original_due), zone);
        const logged = await serverEntity(
          job.owner,
          await habitLogId(entity.id, day),
        );
        if (Number(logged?.data.value || 0) >= Number(entity.data.goal || 1)) {
          await database
            .prepare("UPDATE reminder_jobs SET state='done',lease=0 WHERE id=?")
            .bind(job.id)
            .run();
          await database
            .prepare(
              'INSERT INTO reminder_schedule_queue (owner,entity,revision) VALUES (?,?,?) ON CONFLICT(owner,entity) DO UPDATE SET revision=excluded.revision',
            )
            .bind(job.owner, job.entity, job.id)
            .run();
          continue;
        }
      }
      if (
        entity.kind === 'settings' &&
        entity.data.checkInsEnabled &&
        entity.data.checkInReminder
      ) {
        const day = dateKey(new Date(job.original_due), zone);
        const checkInDue = zonedInstant(
          day,
          stringValue(entity.data.checkInReminder),
          zone,
        );
        if (
          checkInDue === job.original_due &&
          (await serverEntity(job.owner, `checkin-${day}`))
        ) {
          await database
            .prepare("UPDATE reminder_jobs SET state='done',lease=0 WHERE id=?")
            .bind(job.id)
            .run();
          continue;
        }
      }
      const subscriptions = await database
        .prepare(
          'SELECT endpoint,payload FROM push_subscriptions WHERE owner=?',
        )
        .bind(job.owner)
        .all<{ endpoint: string; payload: string }>();
      if (!subscriptions.results.length) {
        await database
          .prepare(
            "UPDATE reminder_jobs SET state='pending',lease=0,due=?,last_error='No subscribed devices' WHERE id=?",
          )
          .bind(now + 300000, job.id)
          .run();
        continue;
      }
      let delivered = 0;
      for (const sub of subscriptions.results) {
        if (!(await workspaceReady(job.owner))) break;
        const previous = await database
          .prepare(
            'SELECT delivered FROM reminder_deliveries WHERE job=? AND endpoint=? AND round=?',
          )
          .bind(job.id, sub.endpoint, job.round)
          .first();
        if (previous) {
          delivered++;
          continue;
        }
        const url =
          entity.kind === 'task'
            ? `/#task/${entity.id}`
            : entity.kind === 'assignment'
              ? '/#school'
              : entity.kind === 'alarm'
                ? '/#alarms'
                : entity.kind === 'habit'
                  ? '/#habits'
                  : '/#focus';
        const response = await sendPush(
          JSON.parse(sub.payload) as WebSubscription,
          stringValue(
            entity.data.title || entity.data.label || 'Stride reminder',
          ),
          entity.kind === 'settings'
            ? 'Your timer or daily check-in is ready.'
            : entity.kind === 'habit'
              ? 'A small step for your daily routine.'
              : entity.kind === 'alarm'
                ? 'Alarm ringing.'
                : entity.kind === 'assignment'
                  ? 'Your assignment is ready for attention.'
                  : 'Your task is ready for attention.',
          url,
          job.id,
          entity.kind === 'alarm'
            ? {
                alarmId: entity.id,
                occurrence: new Date(job.original_due).toISOString(),
              }
            : {},
        );
        if (response.ok) {
          await database
            .prepare(
              'INSERT OR IGNORE INTO reminder_deliveries (job,endpoint,round,delivered) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM reminder_jobs WHERE id=?)',
            )
            .bind(job.id, sub.endpoint, job.round, now, job.id)
            .run();
          delivered++;
        } else if (response.status === 404 || response.status === 410)
          await database
            .prepare(
              'DELETE FROM push_subscriptions WHERE owner=? AND endpoint=?',
            )
            .bind(job.owner, sub.endpoint)
            .run();
        else throw new Error(`Push ${response.status}`);
      }
      if (delivered) sent++;
      const attempts = job.attempts + 1;
      const repeat = job.repeat_minutes >= 5 && attempts < 12;
      await database.batch([
        database
          .prepare(
            'UPDATE reminder_jobs SET state=?,attempts=?,lease=0,due=?,last_error=?,round=round+1 WHERE id=?',
          )
          .bind(
            repeat ? 'pending' : 'done',
            attempts,
            repeat ? now + job.repeat_minutes * 60000 : job.due,
            '',
            job.id,
          ),
        database
          .prepare(
            'INSERT INTO reminder_schedule_queue (owner,entity,revision) VALUES (?,?,?) ON CONFLICT(owner,entity) DO UPDATE SET revision=excluded.revision',
          )
          .bind(job.owner, job.entity, job.id),
      ]);
    } catch {
      failed++;
      const attempts = job.attempts + 1;
      await database
        .prepare(
          'UPDATE reminder_jobs SET state=?,attempts=?,lease=0,due=?,last_error=? WHERE id=?',
        )
        .bind(
          attempts < 12 ? 'pending' : 'failed',
          attempts,
          now + Math.min(900000, 30000 * 2 ** attempts),
          'Delivery failed; retry scheduled',
          job.id,
        )
        .run();
    }
  }
  return Response.json(
    { claimed: claimed.results.length, sent, failed },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

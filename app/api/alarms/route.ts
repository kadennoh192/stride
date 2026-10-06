import { resetBoundary } from '@/lib/server/reset';
import { authorize } from '@/lib/server/auth';
import { sameOrigin } from '@/lib/server/bindings';
import { serverEntity } from '@/lib/server/reminders';
import { saveCloudEdits } from '@/lib/server/workspace';
import { alarmActionPatch } from '@/lib/stride/alarms';
import type { Alarm } from '@/lib/stride/types';

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 });
  const user = await authorize(request);
  if (user instanceof Response) return user;
  if (!user)
    return Response.json(
      { error: 'Sign in to control background alarms' },
      { status: 401 },
    );
  const boundary = await resetBoundary(request, user.id);
  if (boundary) return boundary;
  try {
    if (Number(request.headers.get('content-length')) > 2000)
      return Response.json({ error: 'Request too large' }, { status: 413 });
    const input = (await request.json()) as {
      id?: string;
      occurrence?: string;
      action?: string;
    };
    if (
      !input.id ||
      !/^[a-zA-Z0-9_-]{1,150}$/.test(input.id) ||
      !input.occurrence ||
      !Number.isFinite(Date.parse(input.occurrence)) ||
      !['snooze', 'dismiss'].includes(input.action || '')
    )
      return Response.json({ error: 'Invalid alarm action' }, { status: 400 });
    const entity = await serverEntity(user.id, input.id);
    if (!entity || entity.deleted || entity.kind !== 'alarm')
      return Response.json({ error: 'Alarm unavailable' }, { status: 404 });
    const alarm = entity as Alarm;
    if (alarm.data.acknowledgedOccurrence === input.occurrence)
      return Response.json({ acknowledged: true });
    if (!alarm.data.enabled || alarm.data.nextOccurrence !== input.occurrence)
      return Response.json(
        { error: 'Alarm occurrence changed' },
        { status: 409 },
      );
    const data = alarmActionPatch(
      alarm,
      input.action as 'snooze' | 'dismiss',
      Date.now(),
    );
    await saveCloudEdits(
      user.id,
      [{ id: alarm.id, kind: 'alarm', data }],
      input.action === 'snooze'
        ? 'Snoozed alarm from notification'
        : 'Dismissed alarm from notification',
    );
    return Response.json(
      { acknowledged: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { error: 'Alarm action could not be saved. Open Stride to retry.' },
      { status: 503 },
    );
  }
}

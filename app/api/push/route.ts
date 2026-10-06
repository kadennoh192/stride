import { resetBoundary } from '@/lib/server/reset';
import { authorize } from '@/lib/server/auth';
import { db, sameOrigin } from '@/lib/server/bindings';
import {
  pushConfig,
  pushConfigured,
  validEndpoint,
  sendPush,
} from '@/lib/server/reminders';
import type { PushSubscription as WebSubscription } from '@block65/webcrypto-web-push';
export async function GET(request: Request) {
  const user = await authorize(request);
  if (user instanceof Response) return user;
  return Response.json(
    {
      configured: pushConfigured(),
      publicKey: pushConfig().publicKey,
      signedIn: !!user,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 });
  const user = await authorize(request);
  if (user instanceof Response) return user;
  if (!user)
    return Response.json(
      { error: 'Sign in to enable background reminders.' },
      { status: 401 },
    );
  if (!pushConfigured())
    return Response.json(
      { error: 'Background reminders are not configured on the server.' },
      { status: 503 },
    );
  const boundary = await resetBoundary(request, user.id);
  if (boundary) return boundary;
  try {
    const input = (await request.json()) as {
      action?: string;
      subscription: WebSubscription;
    };
    const s = input.subscription;
    if (
      !s ||
      !validEndpoint(s.endpoint) ||
      !s.keys ||
      !/^[\w-]{80,150}$/.test(s.keys.p256dh) ||
      !/^[\w-]{20,100}$/.test(s.keys.auth)
    )
      return Response.json(
        {
          error:
            'This push subscription is invalid or its provider is unsupported.',
        },
        { status: 400 },
      );
    if (input.action === 'remove') {
      await db()
        .prepare('DELETE FROM push_subscriptions WHERE owner=? AND endpoint=?')
        .bind(user.id, s.endpoint)
        .run();
      return Response.json({ ok: true });
    }
    await db()
      .prepare(
        'INSERT INTO push_subscriptions (owner,endpoint,payload,created) VALUES (?,?,?,?) ON CONFLICT(owner,endpoint) DO UPDATE SET payload=excluded.payload',
      )
      .bind(user.id, s.endpoint, JSON.stringify(s), Date.now())
      .run();
    if (input.action === 'test') {
      const r = await sendPush(
        s,
        'Stride is ready',
        'Background reminders are connected.',
        '/#settings',
        'stride-test',
      );
      if (!r.ok)
        return Response.json(
          {
            error:
              'The push service rejected the test. Reconnect notifications.',
          },
          { status: 502 },
        );
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: 'Unable to connect notifications. Please retry.' },
      { status: 503 },
    );
  }
}

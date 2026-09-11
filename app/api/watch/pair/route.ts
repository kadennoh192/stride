import { authorize } from '@/lib/server/auth';
import { db, sameOrigin } from '@/lib/server/bindings';
import { pairingCode, randomToken, sha256 } from '@/lib/server/watch';

const noStore = { 'Cache-Control': 'no-store' };

async function body(request: Request) {
  if (Number(request.headers.get('content-length')) > 10000)
    throw new Error('Request too large');
  const text = await request.text();
  if (text.length > 10000) throw new Error('Request too large');
  return JSON.parse(text) as Record<string, unknown>;
}

export async function POST(request: Request) {
  try {
    const input = await body(request);
    if (input.action === 'create') {
      if (!sameOrigin(request))
        return Response.json({ error: 'Origin not allowed' }, { status: 403 });
      const user = await authorize(request);
      if (user instanceof Response) return user;
      if (!user)
        return Response.json(
          { error: 'Sign in before pairing Apple Watch.' },
          { status: 401, headers: noStore },
        );
      const code = pairingCode();
      const now = new Date();
      const expires = new Date(now.getTime() + 10 * 60_000);
      const database = db();
      await database.batch([
        database
          .prepare(
            "DELETE FROM watch_tokens WHERE expires<=? OR (owner=? AND token_hash LIKE 'pair:%')",
          )
          .bind(now.toISOString(), user.id),
        database
          .prepare(
            'INSERT INTO watch_tokens (token_hash,owner,created,expires) VALUES (?,?,?,?)',
          )
          .bind(
            `pair:${await sha256(code)}`,
            user.id,
            now.toISOString(),
            expires.toISOString(),
          ),
      ]);
      return Response.json(
        { code, expires: expires.toISOString() },
        { headers: noStore },
      );
    }
    if (input.action === 'revoke') {
      if (!sameOrigin(request))
        return Response.json({ error: 'Origin not allowed' }, { status: 403 });
      const user = await authorize(request);
      if (user instanceof Response) return user;
      if (!user)
        return Response.json({ error: 'Sign in required' }, { status: 401 });
      await db()
        .prepare('DELETE FROM watch_tokens WHERE owner=?')
        .bind(user.id)
        .run();
      return Response.json({ revoked: true }, { headers: noStore });
    }
    if (input.action === 'redeem') {
      const code =
        typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
      if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(code))
        return Response.json(
          { error: 'Enter the eight-character pairing code.' },
          { status: 400, headers: noStore },
        );
      const hash = `pair:${await sha256(code)}`;
      const database = db();
      const pair = await database
        .prepare(
          'DELETE FROM watch_tokens WHERE token_hash=? RETURNING owner,expires',
        )
        .bind(hash)
        .first<{ owner: string; expires: string }>();
      if (!pair || Date.parse(pair.expires) <= Date.now()) {
        return Response.json(
          { error: 'That pairing code is invalid or expired.' },
          { status: 401, headers: noStore },
        );
      }
      const token = randomToken();
      const now = new Date();
      const expires = new Date(now);
      expires.setUTCFullYear(expires.getUTCFullYear() + 1);
      await database
        .prepare(
          'INSERT INTO watch_tokens (token_hash,owner,created,expires) VALUES (?,?,?,?)',
        )
        .bind(
          `token:${await sha256(token)}`,
          pair.owner,
          now.toISOString(),
          expires.toISOString(),
        )
        .run();
      return Response.json(
        { token, expires: expires.toISOString() },
        { headers: noStore },
      );
    }
    return Response.json(
      { error: 'Invalid pairing action' },
      { status: 400, headers: noStore },
    );
  } catch {
    return Response.json(
      { error: 'Watch pairing is temporarily unavailable.' },
      { status: 503, headers: noStore },
    );
  }
}

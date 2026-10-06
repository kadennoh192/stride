import { workspaceReady } from './reset';
import { db } from './bindings';

const encoder = new TextEncoder();

export async function sha256(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function randomToken(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function pairingCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

export async function watchOwner(request: Request): Promise<string | null> {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  if (!match) return null;
  const hash = `token:${await sha256(match[1])}`;
  const row = await db()
    .prepare(
      'SELECT owner,expires FROM watch_tokens WHERE token_hash=? LIMIT 1',
    )
    .bind(hash)
    .first<{ owner: string; expires: string }>();
  if (!row) return null;
  if (Date.parse(row.expires) <= Date.now()) {
    await db()
      .prepare('DELETE FROM watch_tokens WHERE token_hash=?')
      .bind(hash)
      .run();
    return null;
  }
  return (await workspaceReady(row.owner)) ? row.owner : null;
}

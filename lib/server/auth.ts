import { env } from 'cloudflare:workers';
export function authConfig() {
  const e = env as unknown as Record<string, string>;
  return {
    url: e.SUPABASE_URL || '',
    key: e.SUPABASE_ANON_KEY || '',
    ownerEmail: (e.STRIDE_OWNER_EMAIL || '').trim().toLowerCase(),
  };
}
export function cookies(request: Request): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const split = part.indexOf('=');
    if (split < 1) continue;
    try {
      result[decodeURIComponent(part.slice(0, split).trim())] =
        decodeURIComponent(part.slice(split + 1));
    } catch {
      /* Ignore malformed cookies instead of failing authentication for the whole request. */
    }
  }
  return result;
}
type AuthFlowType = 'signup' | 'recovery';
export interface AuthFlow {
  type: AuthFlowType;
  verifier: string;
  challenge: string;
}
const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
export async function createAuthFlow(type: AuthFlowType): Promise<AuthFlow> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64Url(verifierBytes);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return { type, verifier, challenge: base64Url(new Uint8Array(digest)) };
}
export function readAuthFlow(
  request: Request,
): Omit<AuthFlow, 'challenge'> | null {
  const raw = cookies(request).stride_auth_flow || '';
  const split = raw.indexOf('.');
  const type = raw.slice(0, split);
  const verifier = raw.slice(split + 1);
  if (
    !['signup', 'recovery'].includes(type) ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)
  )
    return null;
  return { type: type as AuthFlowType, verifier };
}
export function setAuthFlow(
  headers: Headers,
  flow: Pick<AuthFlow, 'type' | 'verifier'> | null,
  request: Request,
) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  headers.append(
    'Set-Cookie',
    `stride_auth_flow=${flow ? `${flow.type}.${flow.verifier}` : ''}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=${flow ? 900 : 0}${secure}`,
  );
}
export const unavailable = () =>
  Response.json(
    { error: 'Account service unavailable. Your device data remains saved.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
export async function authorize(request: Request) {
  try {
    return await getUser(request);
  } catch {
    return unavailable();
  }
}
export async function getUser(
  request: Request,
): Promise<{ id: string; email: string } | null> {
  const config = authConfig();
  const token = cookies(request).stride_access;
  if (!token || !config.url || !config.key || !config.ownerEmail) return null;
  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.key, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error('Account service unavailable');
    const user = (await response.json()) as { id: string; email: string };
    if (user.email.trim().toLowerCase() !== config.ownerEmail) return null;
    return user.id ? user : null;
  } catch {
    throw new Error('Account service unavailable');
  }
}
export function setSession(
  headers: Headers,
  data: { access_token?: string; refresh_token?: string },
  request: Request,
) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  headers.append(
    'Set-Cookie',
    `stride_access=${encodeURIComponent(data.access_token || '')}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${data.access_token ? 3600 : 0}${secure}`,
  );
  headers.append(
    'Set-Cookie',
    `stride_refresh=${encodeURIComponent(data.refresh_token || '')}; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=${data.refresh_token ? 2592000 : 0}${secure}`,
  );
}

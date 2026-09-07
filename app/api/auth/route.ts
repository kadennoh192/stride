import {
  authConfig,
  cookies,
  authorize,
  unavailable,
  setSession,
} from '@/lib/server/auth';
import { sameOrigin } from '@/lib/server/bindings';
const noStore = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  const config = authConfig();
  if (!config.url || !config.key)
    return Response.json(
      { configured: false, user: null },
      { headers: noStore },
    );
  const user = await authorize(request);
  if (user instanceof Response) return user;
  if (user)
    return Response.json({ configured: true, user }, { headers: noStore });
  const refresh = cookies(request).stride_refresh;
  if (refresh) {
    try {
      const r = await fetch(
        `${config.url}/auth/v1/token?grant_type=refresh_token`,
        {
          method: 'POST',
          headers: { apikey: config.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (r.status >= 500 || r.status === 429) return unavailable();
      if (r.ok) {
        const data = (await r.json()) as {
          access_token: string;
          refresh_token: string;
          user: { id: string; email: string };
        };
        const headers = new Headers(noStore);
        setSession(headers, data, request);
        return Response.json(
          {
            configured: true,
            user: { id: data.user.id, email: data.user.email },
          },
          { headers },
        );
      }
    } catch {
      return Response.json(
        { error: 'Account service unavailable' },
        { status: 503, headers: noStore },
      );
    }
  }
  return Response.json({ configured: true, user: null }, { headers: noStore });
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: 'Origin not allowed' }, { status: 403 });
  const config = authConfig();
  if (!config.url || !config.key)
    return Response.json(
      {
        error:
          'Accounts are not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY to the server environment.',
      },
      { status: 503 },
    );
  try {
    const body = (await request.json()) as Record<string, string>;
    const action = body.action;
    const headers = new Headers(noStore);
    if (action === 'logout') {
      const access = cookies(request).stride_access;
      if (access) {
        const result = await fetch(`${config.url}/auth/v1/logout`, {
          method: 'POST',
          headers: { apikey: config.key, Authorization: `Bearer ${access}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!result.ok && ![401, 403].includes(result.status))
          return unavailable();
      }
      setSession(headers, {}, request);
      return Response.json({ ok: true }, { headers });
    }
    const paths: Record<string, string> = {
      login: '/token?grant_type=password',
      signup: '/signup',
      recover: '/recover',
      verify: '/verify',
      password: '/user',
    };
    if (!paths[action])
      return Response.json(
        { error: 'Invalid account action' },
        { status: 400 },
      );
    const data: Record<string, string> =
      action === 'verify'
        ? { token_hash: body.token_hash, type: body.type }
        : action === 'password'
          ? { password: body.password }
          : {
              email: body.email,
              ...(action !== 'recover' ? { password: body.password } : {}),
            };
    const origin = new URL(request.url).origin;
    const r = await fetch(
      `${config.url}/auth/v1${paths[action]}${action === 'signup' || action === 'recover' ? `?redirect_to=${encodeURIComponent(origin)}` : ''}`,
      {
        method: action === 'password' ? 'PUT' : 'POST',
        headers: {
          apikey: config.key,
          'Content-Type': 'application/json',
          ...(action === 'password'
            ? {
                Authorization: `Bearer ${cookies(request).stride_access || ''}`,
              }
            : {}),
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(15000),
      },
    );
    const result = (await r.json()) as {
      error_description?: string;
      msg?: string;
      message?: string;
      access_token?: string;
      refresh_token?: string;
    };
    if (!r.ok)
      return Response.json(
        {
          error:
            result.error_description ||
            result.msg ||
            result.message ||
            'Account request failed',
        },
        { status: 400 },
      );
    if (result.access_token) setSession(headers, result, request);
    return Response.json(
      { ok: true, verifyEmail: action === 'signup' && !result.access_token },
      { headers },
    );
  } catch {
    return Response.json(
      { error: 'Account service is unavailable. Please retry.' },
      { status: 503 },
    );
  }
}

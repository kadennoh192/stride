import { env } from 'cloudflare:workers';
export function db() {
  return (env as unknown as { DB: D1Database }).DB;
}
export function bucket() {
  return (env as unknown as { FILES: R2Bucket }).FILES;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  return (
    origin === new URL(request.url).origin ||
    (!origin && request.headers.get('Sec-Fetch-Site') === 'same-origin')
  );
}

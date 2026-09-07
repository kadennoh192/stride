import { authorize } from '@/lib/server/auth';
import { bucket, sameOrigin } from '@/lib/server/bindings';
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
  const user = await authorize(request);
  if (user instanceof Response) return user;
  if (!user) return new Response('Sign in required', { status: 401 });
  const { id } = await params;
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id))
    return new Response('Invalid file ID', { status: 400 });
  if (Number(request.headers.get('content-length')) > 10000000)
    return new Response('Maximum file size is 10 MB', { status: 413 });
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 10000000)
    return new Response('Maximum file size is 10 MB', { status: 413 });
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (request.headers.get('X-Content-SHA256') !== hash)
    return new Response('Attachment integrity check failed', { status: 400 });
  await bucket().put(`${user.id}/${id}`, bytes, {
    customMetadata: { sha256: hash },
    httpMetadata: {
      contentType:
        request.headers.get('content-type') || 'application/octet-stream',
    },
  });
  return Response.json({ id });
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authorize(request);
  if (user instanceof Response) return user;
  if (!user) return new Response('Sign in required', { status: 401 });
  const { id } = await params;
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id))
    return new Response('Invalid file ID', { status: 400 });
  const file = await bucket().get(`${user.id}/${id}`);
  if (!file) return new Response('File not found', { status: 404 });
  return new Response(file.body, {
    headers: {
      'X-Content-SHA256': file.customMetadata?.sha256 || '',
      'Content-Type':
        file.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Disposition': 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

import { readBounded, sha256, UploadError } from '@/lib/server/file-upload';
import { attachmentId, ATTACHMENT_LIMIT } from '@/lib/stride/attachment-model';
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
  if (
    request.headers.has('X-Stride-Owner') &&
    request.headers.get('X-Stride-Owner') !== user.id
  )
    return new Response('Account changed', { status: 409 });
  const { id } = await params;
  if (!attachmentId.test(id))
    return new Response('Invalid file ID', { status: 400 });
  let bytes: Uint8Array;
  try {
    bytes = await readBounded(request, ATTACHMENT_LIMIT);
  } catch (error) {
    return new Response('Maximum file size is 10 MB', {
      status: error instanceof UploadError ? error.status : 400,
    });
  }
  const hash = await sha256(bytes);
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
  if (
    request.headers.has('X-Stride-Owner') &&
    request.headers.get('X-Stride-Owner') !== user.id
  )
    return new Response('Account changed', { status: 409 });
  const { id } = await params;
  if (!attachmentId.test(id))
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

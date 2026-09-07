import { authorize } from '@/lib/server/auth';
import { sameOrigin } from '@/lib/server/bindings';
import {
  attachmentId,
  contentHash,
  UPLOAD_CHUNK_SIZE,
  validUploadRequest,
} from '@/lib/stride/attachment-model';
import {
  beginUpload,
  uploadPart,
  completeUpload,
  readBounded,
  UploadError,
} from '@/lib/server/file-upload';
type RouteContext = { params: Promise<{ id: string }> };
const noStore = { 'Cache-Control': 'private, no-store' };
async function verified(request: Request, context: RouteContext) {
  if (!sameOrigin(request))
    return Response.json(
      { error: 'Origin not allowed' },
      { status: 403, headers: noStore },
    );
  const user = await authorize(request);
  if (user instanceof Response) return user;
  if (!user)
    return Response.json(
      { error: 'Sign in required' },
      { status: 401, headers: noStore },
    );
  if (request.headers.get('X-Stride-Owner') !== user.id)
    return Response.json(
      {
        error:
          'The active account changed. Sign in to the attachment’s account to resume.',
      },
      { status: 409, headers: noStore },
    );
  const { id } = await context.params;
  if (!attachmentId.test(id))
    return Response.json(
      { error: 'Invalid attachment identifier' },
      { status: 400, headers: noStore },
    );
  return { owner: user.id, id };
}
function failed(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof UploadError
          ? error.message
          : 'Attachment transfer is temporarily unavailable. Saved parts will resume.',
    },
    {
      status: error instanceof UploadError ? error.status : 503,
      headers: noStore,
    },
  );
}
export async function POST(request: Request, context: RouteContext) {
  const identity = await verified(request, context);
  if (identity instanceof Response) return identity;
  try {
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(
        new TextDecoder().decode(await readBounded(request, 4096)),
      );
    } catch (error) {
      if (error instanceof UploadError) throw error;
      throw new UploadError('Invalid upload metadata.');
    }
    if (!input || typeof input !== 'object')
      throw new UploadError('Invalid upload metadata.');
    if (input.action === 'begin' && validUploadRequest(input))
      return Response.json(
        await beginUpload(identity.owner, identity.id, input),
        { headers: noStore },
      );
    if (
      input.action === 'complete' &&
      typeof input.hash === 'string' &&
      contentHash.test(input.hash)
    ) {
      await completeUpload(identity.owner, identity.id, input.hash);
      return Response.json({ complete: true }, { headers: noStore });
    }
    throw new UploadError('Invalid upload action or metadata.');
  } catch (error) {
    return failed(error);
  }
}
export async function PUT(request: Request, context: RouteContext) {
  const identity = await verified(request, context);
  if (identity instanceof Response) return identity;
  try {
    const url = new URL(request.url),
      hash = url.searchParams.get('hash') || '',
      part = url.searchParams.get('part') || '';
    const digest = request.headers.get('X-Content-SHA256') || '';
    if (
      !contentHash.test(hash) ||
      !contentHash.test(digest) ||
      !/^\d{1,2}$/.test(part)
    )
      throw new UploadError('Invalid upload part.');
    await uploadPart(
      identity.owner,
      identity.id,
      hash,
      Number(part),
      await readBounded(request, UPLOAD_CHUNK_SIZE),
      digest,
    );
    return Response.json({ part: Number(part) }, { headers: noStore });
  } catch (error) {
    return failed(error);
  }
}

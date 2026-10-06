import { authorize } from '@/lib/server/auth';
import { sameOrigin } from '@/lib/server/bindings';
import { initializeWorkspaceReset } from '@/lib/server/reset';
import { RESET_GENERATION, RESET_HEADER } from '@/lib/stride/reset-generation';
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!sameOrigin(request))
    return Response.json(
      { error: 'Origin not allowed' },
      { status: 403, headers },
    );
  const user = await authorize(request);
  if (user instanceof Response) return user;
  if (!user)
    return Response.json(
      { error: 'Sign in required' },
      { status: 401, headers },
    );
  if (request.headers.get(RESET_HEADER) !== RESET_GENERATION)
    return Response.json(
      { error: 'Update Stride before initializing the workspace.' },
      { status: 426, headers },
    );
  try {
    const progress = await initializeWorkspaceReset(user.id);
    return Response.json(
      {
        generation: progress.generation,
        complete: progress.phase === 'complete',
        phase: progress.phase,
        completedAt: progress.completed_at,
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: 'Workspace cleanup was interrupted. Retry to resume safely.' },
      { status: 503, headers },
    );
  }
}

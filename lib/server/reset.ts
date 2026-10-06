import { bucket, db } from './bindings';
import { RESET_GENERATION, RESET_HEADER } from '../stride/reset-generation';

interface ResetProgress {
  generation: string;
  phase: 'd1' | 'files' | 'uploads' | 'verify' | 'complete';
  completed_at: string;
}
const noStore = { 'Cache-Control': 'no-store' };
export async function resetProgress(owner: string) {
  return db()
    .prepare(
      'SELECT generation,phase,completed_at FROM workspace_resets WHERE owner=?',
    )
    .bind(owner)
    .first<ResetProgress>();
}
export async function workspaceReady(owner: string) {
  const progress = await resetProgress(owner);
  return (
    progress?.generation === RESET_GENERATION && progress.phase === 'complete'
  );
}
/** All browser workspace APIs require the fixed boundary, including file reads. */
export async function resetBoundary(
  request: Request,
  owner: string,
): Promise<Response | null> {
  if (request.headers.get(RESET_HEADER) !== RESET_GENERATION)
    return Response.json(
      {
        error: 'Update Stride before accessing this workspace.',
        upgradeRequired: true,
      },
      { status: 426, headers: noStore },
    );
  if (!(await workspaceReady(owner)))
    return Response.json(
      {
        error: 'Workspace reset is in progress. Retry initialization.',
        resetRequired: true,
      },
      { status: 423, headers: noStore },
    );
  return null;
}

function deletionStatements(owner: string) {
  const database = db();
  return [
    database
      .prepare(
        'DELETE FROM reminder_deliveries WHERE job IN (SELECT id FROM reminder_jobs WHERE owner=?)',
      )
      .bind(owner),
    ...[
      'reminder_jobs',
      'reminder_schedule_queue',
      'push_subscriptions',
      'watch_tokens',
      'fields',
      'changes',
      'dedup',
    ].map((table) =>
      database.prepare(`DELETE FROM ${table} WHERE owner=?`).bind(owner),
    ),
  ];
}
/** A lease prevents concurrent initializers from marking completion over a
 * still-running purge. Each request does bounded R2 work; retries resume by
 * scanning the remaining prefix, without a cursor that can skip deleted keys. */
export async function initializeWorkspaceReset(
  owner: string,
): Promise<ResetProgress> {
  const database = db();
  await database
    .prepare(
      "INSERT OR IGNORE INTO workspace_resets (owner,generation,phase) VALUES (?,?,'d1')",
    )
    .bind(owner, RESET_GENERATION)
    .run();
  const existing = await resetProgress(owner);
  if (!existing || existing.generation !== RESET_GENERATION)
    throw new Error('Unsupported workspace reset generation.');
  if (existing.phase === 'complete') return existing;
  const lease = crypto.randomUUID();
  const acquired = await database
    .prepare(
      "UPDATE workspace_resets SET lease=?,lease_until=? WHERE owner=? AND generation=? AND phase!='complete' AND lease_until<? RETURNING phase",
    )
    .bind(lease, Date.now() + 600000, owner, RESET_GENERATION, Date.now())
    .first<{ phase: ResetProgress['phase'] }>();
  if (!acquired) return existing;
  let phase = acquired.phase;
  const renew = async () => {
    const held = await database
      .prepare(
        "UPDATE workspace_resets SET lease_until=? WHERE owner=? AND lease=? AND lease_until>? AND phase!='complete' RETURNING owner",
      )
      .bind(Date.now() + 600000, owner, lease, Date.now())
      .first();
    if (!held)
      throw new Error('Workspace cleanup lease expired. Retry initialization.');
  };
  const advance = async (next: ResetProgress['phase']) => {
    await renew();
    await database
      .prepare('UPDATE workspace_resets SET phase=? WHERE owner=? AND lease=?')
      .bind(next, owner, lease)
      .run();
    phase = next;
  };
  try {
    if (phase === 'd1') {
      await renew();
      await database.batch(deletionStatements(owner));
      await advance('files');
    }
    for (
      let pageNumber = 0;
      pageNumber < 5 && (phase === 'files' || phase === 'uploads');
      pageNumber++
    ) {
      const prefix =
        phase === 'files' ? `${owner}/` : `__stride_uploads/${owner}/`;
      const page = await bucket().list({ prefix, limit: 100 });
      await renew();
      if (page.objects.length)
        await bucket().delete(page.objects.map((object) => object.key));
      if (!page.truncated)
        await advance(phase === 'files' ? 'uploads' : 'verify');
    }
    if (phase === 'verify') {
      await renew();
      await bucket().delete(`__stride_upload_gc/${owner}`);
      // Final D1 deletion also removes scheduling/delivery work that was already
      // in flight when initialization revoked the workspace.
      await database.batch(deletionStatements(owner));
      const counts = await database
        .prepare(
          'SELECT (SELECT count(*) FROM fields WHERE owner=?)+(SELECT count(*) FROM changes WHERE owner=?)+(SELECT count(*) FROM dedup WHERE owner=?)+(SELECT count(*) FROM reminder_jobs WHERE owner=?)+(SELECT count(*) FROM reminder_schedule_queue WHERE owner=?)+(SELECT count(*) FROM push_subscriptions WHERE owner=?)+(SELECT count(*) FROM watch_tokens WHERE owner=?) AS remaining',
        )
        .bind(owner, owner, owner, owner, owner, owner, owner)
        .first<{ remaining: number }>();
      const durable = await bucket().list({ prefix: `${owner}/`, limit: 1 });
      const temporary = await bucket().list({
        prefix: `__stride_uploads/${owner}/`,
        limit: 1,
      });
      if (
        counts?.remaining ||
        durable.objects.length ||
        temporary.objects.length
      )
        throw new Error('Workspace cleanup needs another attempt.');
      await database
        .prepare(
          "UPDATE workspace_resets SET phase='complete',completed_at=? WHERE owner=? AND lease=? AND lease_until>?",
        )
        .bind(new Date().toISOString(), owner, lease, Date.now())
        .run();
    }
  } finally {
    await database
      .prepare(
        "UPDATE workspace_resets SET lease='',lease_until=0 WHERE owner=? AND lease=?",
      )
      .bind(owner, lease)
      .run();
  }
  return (await resetProgress(owner))!;
}

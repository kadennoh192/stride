import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { blank, applyEdits } from '../lib/stride/storage';
import { taskData } from '../lib/stride/types';

void test('real D1 sync enforces account ownership, idempotence, durable scheduling, and outage handling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stride-api-test-'));
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("Test storage");}}',
    d1Databases: ['DB'],
    r2Buckets: ['FILES'],
  });
  const originalFetch = globalThis.fetch;
  try {
    const DB = await mf.getD1Database('DB');
    const FILES = await mf.getR2Bucket('FILES');
    for (const name of (await readdir('drizzle'))
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      const sql = await readFile(join('drizzle', name), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint'))
        if (statement.trim()) await DB.prepare(statement).run();
    }
    const globals = globalThis as unknown as { __strideTestEnv: unknown };
    globals.__strideTestEnv = {
      DB,
      FILES,
      SUPABASE_URL: 'https://auth.stride.test',
      SUPABASE_ANON_KEY: 'test-public-key',
    };
    let outage = false;
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith('https://auth.stride.test/')) {
        if (outage)
          return Response.json({ error: 'Unavailable' }, { status: 503 });
        const token = new Headers(init?.headers).get('Authorization');
        return token === 'Bearer valid-alice'
          ? Response.json({ id: 'alice', email: 'alice@example.test' })
          : Response.json({ error: 'Expired' }, { status: 401 });
      }
      return originalFetch(input, init);
    };
    const output = join(directory, 'server.mjs');
    await build({
      stdin: {
        contents:
          "export * as sync from './app/api/sync/route'; export * as auth from './app/api/auth/route'; export * as files from './app/api/files/[id]/route'; export * as reminders from './lib/server/reminders';",
        resolveDir: process.cwd(),
      },
      outfile: output,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node24',
      plugins: [
        {
          name: 'test-bindings',
          setup(builder) {
            builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
              path: 'bindings',
              namespace: 'stride-test',
            }));
            builder.onLoad({ filter: /.*/, namespace: 'stride-test' }, () => ({
              contents: 'export const env=globalThis.__strideTestEnv;',
              loader: 'js',
            }));
          },
        },
      ],
    });
    const api = await import(pathToFileURL(output).href);
    const state = blank('alice');
    applyEdits(
      state,
      [{ id: 'test-task', kind: 'task', data: taskData('Sync me') }],
      'Create',
    );
    const make = (
      body: unknown,
      cookie = 'stride_access=valid-alice',
      origin = 'https://stride.test',
    ) =>
      new Request('https://stride.test/api/sync', {
        method: 'POST',
        headers: {
          Origin: origin,
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    const input = {
      version: 2,
      owner: 'alice',
      cursor: 0,
      changes: state.outbox,
    };
    assert.equal(
      (await api.sync.POST(make(input, '', 'https://evil.test'))).status,
      403,
    );
    assert.equal((await api.sync.POST(make(input, ''))).status, 401);
    assert.equal(
      (await api.sync.POST(make({ ...input, owner: 'bob' }))).status,
      409,
    );
    // Force scheduling to fail after the durable operation commits.
    await DB.prepare(
      'ALTER TABLE reminder_jobs RENAME TO temporarily_unavailable_jobs',
    ).run();
    let response = await api.sync.POST(make(input));
    assert.equal(response.status, 200);
    assert.equal(
      await DB.prepare(
        'SELECT COUNT(*) as n FROM reminder_schedule_queue',
      ).first('n'),
      1,
    );
    await DB.prepare(
      'ALTER TABLE temporarily_unavailable_jobs RENAME TO reminder_jobs',
    ).run();
    response = await api.sync.POST(make(input));
    const synced = await response.json();
    assert.deepEqual(
      synced.acknowledged,
      state.outbox.map((c) => c.id),
    );
    assert.equal(
      await DB.prepare('SELECT COUNT(*) as n FROM changes').first('n'),
      1,
    );
    assert.equal(
      await DB.prepare(
        'SELECT COUNT(*) as n FROM reminder_schedule_queue',
      ).first('n'),
      0,
    );
    const reused = structuredClone(input);
    reused.changes[0].label = 'Different operation';
    assert.equal((await api.sync.POST(make(reused))).status, 409);
    assert.equal(
      (
        await api.sync.POST(
          make({ ...input, changes: [], cursor: synced.cursor }),
        )
      ).status,
      200,
    );
    const malformed = structuredClone(input);
    malformed.changes[0].id = 'invalid-record';
    malformed.changes[0].fields.find((f) => f.key === 'title')!.value = '';
    for (const field of malformed.changes[0].fields)
      field.stamp = '009999999999999-test';
    assert.equal((await api.sync.POST(make(malformed))).status, 400);
    assert.equal(
      await DB.prepare('SELECT COUNT(*) as n FROM changes').first('n'),
      1,
    );
    // A broken unrelated cookie must not prevent a verified session.
    assert.equal(
      (
        await api.sync.POST(
          make(
            { ...input, changes: [] },
            'bad=%E0%A4%A; stride_access=valid-alice',
          ),
        )
      ).status,
      200,
    );
    outage = true;
    assert.equal((await api.sync.POST(make(input))).status, 503);
    assert.equal(
      (
        await api.auth.GET(
          new Request('https://stride.test/api/auth', {
            headers: { Cookie: 'stride_access=valid-alice' },
          }),
        )
      ).status,
      503,
    );
    outage = false;
    const bytes = new TextEncoder().encode('attachment bytes');
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    ]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const upload = new Request('https://stride.test/api/files/test-file', {
      method: 'PUT',
      headers: {
        Origin: 'https://stride.test',
        Cookie: 'stride_access=valid-alice',
        'X-Content-SHA256': digest,
      },
      body: bytes,
    });
    assert.equal(
      (
        await api.files.PUT(upload, {
          params: Promise.resolve({ id: 'test-file' }),
        })
      ).status,
      200,
    );
    const downloaded = await api.files.GET(
      new Request(upload.url, {
        headers: { Cookie: 'stride_access=valid-alice' },
      }),
      { params: Promise.resolve({ id: 'test-file' }) },
    );
    assert.equal(await downloaded.text(), 'attachment bytes');
    assert.equal(downloaded.headers.get('X-Content-SHA256'), digest);
    assert.equal(downloaded.headers.get('Cache-Control'), 'private, no-store');
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

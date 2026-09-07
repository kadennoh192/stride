import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { uploadFile } from '../lib/stride/upload';
import {
  hashBlob,
  blank,
  applyEdits,
  saveFile,
  getLocalFile,
  uploadProgress,
  closeStorage,
} from '../lib/stride/storage';
import { taskData } from '../lib/stride/types';

void test('real D1 sync and dispatch enforce ownership, idempotence, durable scheduling, and leased claims', async () => {
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
      VAPID_PUBLIC_KEY: 'test-public-key',
      VAPID_PRIVATE_KEY: 'test-private-key',
      VAPID_SUBJECT: 'mailto:owner@stride.test',
      REMINDER_DISPATCH_SECRET: 'test-dispatch-secret',
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
          "export * as upload from './app/api/files/[id]/upload/route'; export * as sync from './app/api/sync/route'; export * as auth from './app/api/auth/route'; export * as files from './app/api/files/[id]/route'; export * as push from './app/api/push/route'; export * as dispatch from './app/api/reminders/route';",
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
    const dispatchRequest = async (
      timestamp: string,
      nonce: string,
      body = '{}',
    ) => {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode('test-dispatch-secret'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const signature = [
        ...new Uint8Array(
          await crypto.subtle.sign(
            'HMAC',
            key,
            new TextEncoder().encode(`${timestamp}.${nonce}.${body}`),
          ),
        ),
      ]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
      return new Request('https://stride.test/api/reminders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stride-Time': timestamp,
          'X-Stride-Nonce': nonce,
          'X-Stride-Signature': signature,
        },
        body,
      });
    };
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
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/stride-test-endpoint',
      keys: { p256dh: 'a'.repeat(80), auth: 'b'.repeat(20) },
    };
    const pushRequest = (
      action: string,
      cookie = 'stride_access=valid-alice',
    ) =>
      new Request('https://stride.test/api/push', {
        method: 'POST',
        headers: {
          Origin: 'https://stride.test',
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, subscription }),
      });
    assert.equal((await api.push.POST(pushRequest('subscribe'))).status, 200);
    assert.equal(
      await DB.prepare(
        "SELECT COUNT(*) AS n FROM push_subscriptions WHERE owner='alice'",
      ).first('n'),
      1,
    );
    await DB.prepare(
      'INSERT INTO push_subscriptions (owner,endpoint,payload,created) VALUES (?,?,?,?)',
    )
      .bind(
        'bob',
        subscription.endpoint,
        JSON.stringify(subscription),
        Date.now(),
      )
      .run();
    assert.equal((await api.push.POST(pushRequest('remove'))).status, 200);
    assert.equal(
      await DB.prepare(
        'SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint=?',
      )
        .bind(subscription.endpoint)
        .first('n'),
      1,
    );
    assert.equal((await api.push.POST(pushRequest('remove', ''))).status, 401);
    const dispatchTime = String(Date.now());
    const dispatchNonce = crypto.randomUUID();
    const dispatch = await api.dispatch.POST(
      await dispatchRequest(dispatchTime, dispatchNonce),
    );
    assert.equal(dispatch.status, 200);
    assert.deepEqual(await dispatch.json(), { claimed: 0, sent: 0, failed: 0 });
    assert.equal(
      (
        await api.dispatch.POST(
          await dispatchRequest(dispatchTime, dispatchNonce),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await api.dispatch.POST(
          await dispatchRequest(
            String(Date.now() - 121000),
            crypto.randomUUID(),
          ),
        )
      ).status,
      403,
    );
    const due = Date.now() - 1000;
    await DB.prepare(
      "INSERT INTO reminder_jobs (id,owner,entity,due,original_due,state,lease) VALUES (?,?,?,?,?,'sending',?)",
    )
      .bind('expired-lease', 'alice', 'missing-task', due, due, due - 1)
      .run();
    const competing = await Promise.all([
      api.dispatch.POST(
        await dispatchRequest(String(Date.now()), crypto.randomUUID()),
      ),
      api.dispatch.POST(
        await dispatchRequest(String(Date.now()), crypto.randomUUID()),
      ),
    ]);
    const dispatchResults = (await Promise.all(
      competing.map((response: Response) => response.json()),
    )) as { claimed: number; sent: number; failed: number }[];
    assert.equal(
      dispatchResults.reduce(
        (sum: number, result: { claimed: number }) => sum + result.claimed,
        0,
      ),
      1,
    );
    assert.equal(
      await DB.prepare(
        "SELECT COUNT(*) AS n FROM reminder_jobs WHERE id='expired-lease' AND state='expired' AND lease=0",
      ).first('n'),
      1,
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
    assert.equal(
      (
        await api.files.GET(
          new Request('https://stride.test/api/files/test-file', {
            headers: {
              Cookie: 'stride_access=valid-alice',
              'X-Stride-Owner': 'bob',
            },
          }),
          { params: Promise.resolve({ id: 'test-file' }) },
        )
      ).status,
      409,
    );
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
    const payload = new Uint8Array(2_400_123);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
    await saveFile(
      'resumable-file',
      new Blob([payload]),
      'alice',
      'resumable.bin',
    );
    const pending = (await getLocalFile('resumable-file', 'alice'))!;
    const routedFetch = globalThis.fetch;
    let interrupt = true;
    const uploadedParts: number[] = [];
    globalThis.fetch = async (input, init) => {
      if (typeof input !== 'string' || !input.startsWith('/api/files/'))
        return routedFetch(input, init);
      const routeURL = new URL(input, 'https://stride.test');
      const headers = new Headers(init?.headers);
      headers.set('Origin', 'https://stride.test');
      headers.set('Cookie', 'stride_access=valid-alice');
      if (init?.method === 'PUT') {
        const part = Number(routeURL.searchParams.get('part'));
        uploadedParts.push(part);
        if (interrupt && part === 1) {
          interrupt = false;
          return Response.json(
            { error: 'Simulated interrupted connection' },
            { status: 503 },
          );
        }
      }
      const request = new Request(routeURL, { ...init, headers });
      return init?.method === 'PUT'
        ? api.upload.PUT(request, {
            params: Promise.resolve({ id: routeURL.pathname.split('/')[3] }),
          })
        : api.upload.POST(request, {
            params: Promise.resolve({ id: routeURL.pathname.split('/')[3] }),
          });
    };
    await assert.rejects(uploadFile(pending), /interrupted/);
    assert.equal(
      (await uploadProgress('resumable-file', 'alice'))?.confirmedBytes,
      1_000_000,
    );
    assert.equal(await FILES.head('alice/resumable-file'), null);
    await closeStorage();
    await uploadFile((await getLocalFile('resumable-file', 'alice'))!);
    assert.deepEqual(uploadedParts, [0, 1, 1, 2]);
    assert.equal(
      (await getLocalFile('resumable-file', 'alice'))?.uploaded,
      true,
    );
    assert.equal(await uploadProgress('resumable-file', 'alice'), undefined);
    const oversizedPart = new Request(
      `https://stride.test/api/files/resumable-file/upload?hash=${pending.hash}&part=0`,
      {
        method: 'PUT',
        headers: {
          Origin: 'https://stride.test',
          Cookie: 'stride_access=valid-alice',
          'X-Stride-Owner': 'alice',
          'X-Content-SHA256': pending.hash,
        },
        body: new Uint8Array(1_000_001),
      },
    );
    assert.equal(
      (
        await api.upload.PUT(oversizedPart, {
          params: Promise.resolve({ id: 'resumable-file' }),
        })
      ).status,
      413,
    );
    const completedFile = await FILES.get('alice/resumable-file');
    assert.deepEqual(
      new Uint8Array(await completedFile!.arrayBuffer()),
      payload,
    );
    await uploadFile(pending);
    assert.deepEqual(uploadedParts, [0, 1, 1, 2]);
    await saveFile('empty-file', new Blob([]), 'alice', 'empty.txt');
    await uploadFile((await getLocalFile('empty-file', 'alice'))!);
    assert.equal((await FILES.head('alice/empty-file'))?.size, 0);
    await saveFile('repair-file', new Blob([payload]), 'alice', 'repair.bin');
    const repair = (await getLocalFile('repair-file', 'alice'))!;
    const repairHeaders = {
      Origin: 'https://stride.test',
      Cookie: 'stride_access=valid-alice',
      'X-Stride-Owner': 'alice',
      'Content-Type': 'application/json',
    };
    const repairBegin = new Request(
      'https://stride.test/api/files/repair-file/upload',
      {
        method: 'POST',
        headers: repairHeaders,
        body: JSON.stringify({
          action: 'begin',
          hash: repair.hash,
          size: payload.length,
          type: '',
          name: 'repair.bin',
        }),
      },
    );
    assert.equal(
      (
        await api.upload.POST(repairBegin, {
          params: Promise.resolve({ id: 'repair-file' }),
        })
      ).status,
      200,
    );
    // Simulate a storage fault after a chunk was acknowledged: metadata remains correct but its bytes differ.
    const partHash = await hashBlob(repair.blob.slice(0, 1_000_000));
    await FILES.put(
      `__stride_uploads/alice/repair-file/${repair.hash}/0`,
      new Uint8Array(1_000_000),
      { customMetadata: { sha256: partHash } },
    );
    await assert.rejects(uploadFile(repair), /integrity check/);
    assert.equal(
      await FILES.head(`__stride_uploads/alice/repair-file/${repair.hash}/0`),
      null,
    );
    const sentBeforeRepair = uploadedParts.length;
    await uploadFile(repair);
    assert.deepEqual(uploadedParts.slice(sentBeforeRepair), [0]);
    assert.deepEqual(
      new Uint8Array(
        await (await FILES.get('alice/repair-file'))!.arrayBuffer(),
      ),
      payload,
    );
    globalThis.fetch = routedFetch;
    const wrongOwner = new Request(
      'https://stride.test/api/files/resumable-file/upload',
      {
        method: 'POST',
        headers: {
          Origin: 'https://stride.test',
          Cookie: 'stride_access=valid-alice',
          'X-Stride-Owner': 'bob',
        },
        body: JSON.stringify({
          action: 'begin',
          hash: pending.hash,
          size: payload.length,
          type: '',
          name: 'file',
        }),
      },
    );
    assert.equal(
      (
        await api.upload.POST(wrongOwner, {
          params: Promise.resolve({ id: 'resumable-file' }),
        })
      ).status,
      409,
    );
    await closeStorage();
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

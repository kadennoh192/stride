import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
void test('offline shell preserves build consistency, excludes account APIs, and rejects login redirects', async () => {
  const handlers = new Map<string, (e: unknown) => void>();
  const stored = new Map<string, Response>();
  let unavailable = false,
    redirect = false;
  const cache = {
    put: async (key: string, r: Response) => {
      stored.set(key, r);
    },
    match: async (key: string) => stored.get(key),
  };
  const caches = {
    open: async () => cache,
    keys: async () => [],
    delete: async () => {
      stored.clear();
      return true;
    },
    match: async (key: string) => stored.get(key),
  };
  const fetch = async (request: Request) => {
    if (unavailable) throw new Error('Offline');
    const r = new Response(
      request.url.endsWith('/') ? 'matching shell' : 'asset',
    );
    Object.defineProperty(r, 'url', { value: request.url });
    Object.defineProperty(r, 'redirected', { value: redirect });
    return r;
  };
  const self = {
    location: { origin: 'https://stride.test' },
    __STRIDE_BUILD__: 'test-build',
    __STRIDE_PRECACHE__: ['/feature.js'],
    addEventListener: (name: string, fn: (e: unknown) => void) =>
      handlers.set(name, fn),
  };
  vm.runInNewContext(await readFile('public/sw.js', 'utf8'), {
    self,
    caches,
    fetch,
    Request,
    Response,
    URL,
    Promise,
  });
  let waiting: Promise<void> | undefined;
  handlers.get('install')!({
    waitUntil: (p: Promise<void>) => {
      waiting = p;
    },
  });
  await waiting;
  assert.ok(stored.has('/feature.js'));
  let response: Promise<Response> | undefined;
  for (const request of [
    new Request('https://stride.test/api/sync'),
    new Request('https://stride.test/api/time'),
    new Request('https://stride.test/', { headers: { RSC: '1' } }),
  ])
    handlers.get('fetch')!({
      request,
      respondWith: (p: Promise<Response>) => {
        response = p;
      },
    });
  assert.equal(response, undefined);
  unavailable = true;
  const request = new Request('https://stride.test/');
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  handlers.get('fetch')!({
    request,
    respondWith: (p: Promise<Response>) => {
      response = p;
    },
  });
  assert.equal(await (await response!).text(), 'matching shell');
  unavailable = false;
  redirect = true;
  handlers.get('install')!({
    waitUntil: (p: Promise<void>) => {
      waiting = p;
    },
  });
  await assert.rejects(waiting!, /authenticated/);
});

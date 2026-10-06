import test from 'node:test';
import assert from 'node:assert/strict';
import scheduler from '../workers/reminders/index';

void test('scheduled reminders authenticate to the private Sites endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let dispatch: Promise<unknown> | undefined;
  try {
    globalThis.fetch = async (input, init) => {
      assert.ok(input instanceof URL);
      assert.equal(input.href, 'https://stride.test/api/reminders');
      const headers = new Headers(init?.headers);
      assert.equal(
        headers.get('OAI-Sites-Authorization'),
        'Bearer site-access-token',
      );
      assert.equal(headers.get('Content-Type'), 'application/json');
      assert.match(headers.get('X-Stride-Signature') ?? '', /^[a-f0-9]{64}$/);
      return new Response(null, { status: 200 });
    };
    await scheduler.scheduled(
      {} as ScheduledController,
      {
        STRIDE_ORIGIN: 'https://stride.test',
        REMINDER_DISPATCH_SECRET: 'dispatch-secret',
        SITES_ACCESS_TOKEN: 'site-access-token',
      } as Env,
      {
        waitUntil: (promise) => {
          dispatch = promise;
        },
      } as ExecutionContext,
    );
    assert.ok(dispatch);
    await dispatch;
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const scheduler = {
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      (async () => {
        if (
          !env.STRIDE_ORIGIN ||
          !env.REMINDER_DISPATCH_SECRET ||
          !env.SITES_ACCESS_TOKEN
        )
          throw new Error('Scheduler environment missing');
        const timestamp = String(Date.now());
        const nonce = crypto.randomUUID();
        const body = '{}';
        const key = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(env.REMINDER_DISPATCH_SECRET),
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
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');
        const response = await fetch(
          new URL('/api/reminders', env.STRIDE_ORIGIN),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Stride-Time': timestamp,
              'X-Stride-Nonce': nonce,
              'X-Stride-Signature': signature,
              'OAI-Sites-Authorization': `Bearer ${env.SITES_ACCESS_TOKEN}`,
            },
            body,
            signal: AbortSignal.timeout(55000),
          },
        );
        if (!response.ok)
          throw new Error(`Reminder dispatch failed: ${response.status}`);
      })(),
    );
  },
};

export default scheduler;

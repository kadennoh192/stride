import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWeather } from '../lib/stride/weather';

void test('GPS denial never makes an IP lookup', async () => {
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests++;
    return Response.json({});
  };
  await assert.rejects(
    loadWeather('gps', fetcher, async () => {
      throw { code: 1 };
    }),
  );
  assert.equal(requests, 0);
});

void test('IP lookup failure does not request weather', async () => {
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests++;
    return new Response('', { status: 503 });
  };
  await assert.rejects(loadWeather('ip', fetcher), /Approximate location/);
  assert.equal(requests, 1);
});

void test('weather uses Open-Meteo and rejects offline failure', async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    urls.push(
      input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : input.url,
    );
    if (urls.length === 1)
      return Response.json({
        latitude: 43.7,
        longitude: -79.4,
        city: 'Toronto',
      });
    return Response.json({ current: { temperature_2m: 17, weather_code: 2 } });
  };
  const reading = await loadWeather('ip', fetcher);
  assert.equal(reading.location, 'Toronto');
  assert.equal(reading.temperature, 17);
  assert.ok(urls[0].startsWith('https://ipapi.co/'));
  assert.ok(urls[1].startsWith('https://api.open-meteo.com/'));
  const offline: typeof fetch = async () => {
    throw new Error('offline');
  };
  await assert.rejects(loadWeather('ip', offline), /offline/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorFromSample,
  bestTimeSample,
  makeClockFormatter,
  resolveClockZone,
  timeFromAnchor,
} from '../lib/stride/network-time';

void test('network clock chooses the least delayed sample and advances monotonically', () => {
  const best = bestTimeSample([
    { epochMs: 1000, receivedAt: 80, roundTripMs: 80 },
    { epochMs: 1100, receivedAt: 120, roundTripMs: 20 },
    { epochMs: 1200, receivedAt: 170, roundTripMs: 50 },
  ]);
  assert.deepEqual(best, {
    epochMs: 1100,
    receivedAt: 120,
    roundTripMs: 20,
  });
  const anchor = anchorFromSample(best!);
  assert.deepEqual(anchor, { epochMs: 1110, monotonicMs: 120 });
  assert.equal(timeFromAnchor(anchor, 170), 1160);
  assert.equal(timeFromAnchor(anchor, 100), 1110);
});

void test('clock timezone choices and locale formatting stay explicit', () => {
  assert.equal(
    resolveClockZone('workspace', 'America/Toronto', 'Asia/Tokyo'),
    'America/Toronto',
  );
  assert.equal(resolveClockZone('workspace', '', 'Asia/Tokyo'), 'Asia/Tokyo');
  assert.equal(
    resolveClockZone('device', 'America/Toronto', 'Asia/Tokyo'),
    'Asia/Tokyo',
  );
  assert.equal(resolveClockZone('utc', 'America/Toronto', 'Asia/Tokyo'), 'UTC');
  assert.equal(
    makeClockFormatter('UTC', 'en-US').format(Date.UTC(2026, 0, 1, 13, 2, 3)),
    '1:02:03 PM',
  );
});

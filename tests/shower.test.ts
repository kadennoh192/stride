import test from 'node:test';
import assert from 'node:assert/strict';
import {
  elapsedShowerSeconds,
  estimatedWaterLitres,
  estimatedSavingsLitres,
} from '../lib/stride/shower';

void test('shower timer restores elapsed time after reload independently of focus timer state', () => {
  const saved = {
    startedAt: 1_000_000,
    elapsedSeconds: 120,
    running: true,
    targetMinutes: 10,
    flowLitresPerMinute: 9,
  };
  assert.equal(elapsedShowerSeconds(saved, 1_180_000), 300);
  assert.equal(
    elapsedShowerSeconds({ ...saved, running: false }, 1_180_000),
    120,
  );
});
void test('completed session estimates use snapshotted target and flow', () => {
  const session = { duration: 480, targetMinutes: 10, flowLitresPerMinute: 9 };
  assert.equal(estimatedWaterLitres(session), 72);
  assert.equal(estimatedSavingsLitres(session), 18);
  assert.equal(estimatedSavingsLitres({ ...session, duration: 720 }), -18);
});

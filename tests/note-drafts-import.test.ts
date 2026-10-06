import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

void test('note drafts can load in a Worker rendering scope without random generation', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `Object.defineProperty(globalThis, 'crypto', { value: {
        randomUUID() { throw new Error('Random generation during module loading'); }
      }});
      const drafts = await import('./lib/stride/note-drafts.ts');
      if (drafts.hasUnsavedNoteDrafts()) throw new Error('Unexpected initial drafts');`,
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

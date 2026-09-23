import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  activationBlockMessage,
  updateStatus,
  validReleaseManifest,
} from '../lib/stride/update-model';
import { currentRelease } from '../lib/stride/generated-release';

void test('release metadata is complete and matches the package and generated manifest', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
    version: string;
  };
  const releases = JSON.parse(await readFile('releases.json', 'utf8')) as {
    version: string;
  }[];
  const publicRelease: unknown = JSON.parse(
    await readFile('public/current-release.json', 'utf8'),
  );
  assert.equal(currentRelease.version, pkg.version);
  assert.equal(releases[0]?.version, pkg.version);
  assert.equal(validReleaseManifest(publicRelease), true);
  assert.deepEqual(publicRelease, currentRelease);
});

void test('manifest comparison distinguishes current, available, and waiting builds', () => {
  assert.equal(
    updateStatus(currentRelease, currentRelease.build, false),
    'current',
  );
  assert.equal(
    updateStatus(
      { ...currentRelease, build: 'new-build' },
      currentRelease.build,
      false,
    ),
    'available',
  );
  assert.equal(
    updateStatus(currentRelease, currentRelease.build, true),
    'waiting',
  );
  assert.equal(
    validReleaseManifest({ ...currentRelease, changes: null }),
    false,
  );
  assert.equal(
    validReleaseManifest({ ...currentRelease, version: 'latest' }),
    false,
  );
});

void test('activation refuses local and cross-tab unsaved drafts', () => {
  assert.match(activationBlockMessage(true, false), /open editor/);
  assert.match(activationBlockMessage(false, true), /Another Stride tab/);
  assert.equal(activationBlockMessage(false, false), '');
});

void test('build emits an uncached deployment manifest and an explicit waiting-worker activation path', async () => {
  const finalizer = await readFile('scripts/finalize-build.mjs', 'utf8');
  const worker = await readFile('public/sw.js', 'utf8');
  assert.match(finalizer, /version\.json/);
  assert.match(finalizer, /Cache-Control: no-store/);
  assert.match(worker, /STRIDE_ACTIVATE_UPDATE/);
  assert.match(worker, /Do not skipWaiting/);
  assert.equal((worker.match(/skipWaiting\(\)/g) || []).length, 1);
});

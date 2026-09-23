import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const root = 'dist/client';
async function walk(path) {
  const files = [];
  for (const item of await readdir(path, { withFileTypes: true })) {
    const full = join(path, item.name);
    if (item.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}
const files = (await walk(root)).filter(
  (path) =>
    /\.(?:js|css|woff2?|png|svg|webmanifest)$/.test(path) &&
    !path.endsWith('/sw.js'),
);
const assets = files
  .map((path) => '/' + relative(root, path).replaceAll('\\', '/'))
  .sort();
const fingerprint = createHash('sha256');
for (const file of files.sort()) fingerprint.update(await readFile(file));
const version = fingerprint.digest('hex').slice(0, 16);
const release = JSON.parse(
  await readFile('public/current-release.json', 'utf8'),
);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (release.version !== pkg.version || !release.build)
  throw new Error('Build release metadata does not match package version');
const source = await readFile('public/sw.js', 'utf8');
await writeFile(
  join(root, 'sw.js'),
  `self.__STRIDE_PRECACHE__ = ${JSON.stringify(assets)};\nself.__STRIDE_BUILD__ = ${JSON.stringify(version)};\n${source}`,
);
await writeFile(
  join(root, 'version.json'),
  JSON.stringify({ ...release, assetBuild: version }),
);
await writeFile(
  join(root, '_headers'),
  '/version.json\n  Cache-Control: no-store, max-age=0\n',
);
console.log(`Offline cache: ${assets.length} local assets, build ${version}`);

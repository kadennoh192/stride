import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { format } from 'oxfmt';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const releases = JSON.parse(await readFile('releases.json', 'utf8'));
const current = releases.find((release) => release.version === pkg.version);
if (
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version) ||
  !current ||
  !/^\d{4}-\d{2}-\d{2}$/.test(current.date) ||
  !current.summary ||
  !current.changes ||
  typeof current.changes !== 'object' ||
  !Object.values(current.changes).every(
    (items) =>
      Array.isArray(items) &&
      items.every((item) => typeof item === 'string' && item.trim()),
  )
)
  throw new Error(`Release metadata for ${pkg.version} is missing or invalid.`);
async function walk(path) {
  const found = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else found.push(full);
  }
  return found;
}
const paths = [
  'package.json',
  'releases.json',
  'public/sw.js',
  ...(
    await Promise.all(['app', 'components', 'lib', 'db', 'workers'].map(walk))
  ).flat(),
]
  .filter((path) => !path.includes('generated-release.'))
  .sort((a, b) => a.localeCompare(b));
const digest = createHash('sha256');
for (const path of paths) {
  digest.update(path);
  digest.update(await readFile(path));
}
const build = digest.digest('hex').slice(0, 16);
const metadata = {
  version: pkg.version,
  build,
  date: current.date,
  summary: current.summary,
  changes: current.changes,
};
const generated = await format(
  'lib/stride/generated-release.ts',
  `export const currentRelease = ${JSON.stringify(metadata, null, 2)} as const;\n`,
  { singleQuote: true, printWidth: 80 },
);
const publicManifest = await format(
  'public/current-release.json',
  `${JSON.stringify(metadata, null, 2)}\n`,
);
if (generated.errors.length || publicManifest.errors.length)
  throw new Error('Release metadata could not be formatted.');
await writeFile('lib/stride/generated-release.ts', generated.code);
await writeFile('public/current-release.json', publicManifest.code);
console.log(`Release ${pkg.version}, build ${build}`);

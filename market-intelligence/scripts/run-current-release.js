import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'config/runtime-release-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const mode = String(process.argv[2] || 'test');

if (manifest.format !== 'investor-control-runtime-release-manifest' || manifest.version !== 1) {
  throw new Error('release runner: invalid runtime manifest');
}

const modeConfig = {
  test: { patches: manifest.testPatches, entry: manifest.entrypoints?.test },
  'run:daily': { patches: manifest.testPatches, entry: manifest.entrypoints?.['run:daily'] },
  'run:autonomous': { patches: manifest.testPatches, entry: manifest.entrypoints?.['run:autonomous'] },
  'build:mobile': { patches: manifest.buildPatches, entry: manifest.entrypoints?.['build:mobile'] },
  'build:autonomous-mobile': { patches: manifest.buildPatches, entry: manifest.entrypoints?.['build:autonomous-mobile'] },
  'publish:reviewed': { patches: [], entry: manifest.entrypoints?.['publish:reviewed'] },
}[mode];

if (!modeConfig) throw new Error(`release runner: unsupported mode ${mode}`);
if (!String(modeConfig.entry || '').trim()) throw new Error(`release runner: missing entrypoint ${mode}`);

const patches = Array.isArray(modeConfig.patches) ? modeConfig.patches : [];
const duplicates = patches.filter((name, index) => patches.indexOf(name) !== index);
if (duplicates.length) throw new Error(`release runner: duplicate patches ${[...new Set(duplicates)].join(', ')}`);

for (const patch of patches) {
  if (!/^apply-v[0-9a-z-]+\.js$/i.test(String(patch))) throw new Error(`release runner: unsafe patch name ${patch}`);
  const absolute = path.join(root, 'scripts', patch);
  if (!fs.existsSync(absolute)) throw new Error(`release runner: patch missing ${patch}`);
  await import(`${pathToFileURL(absolute).href}?release=${encodeURIComponent(manifest.releaseVersion)}&mode=${encodeURIComponent(mode)}`);
}

console.log(`Investor Control release v${manifest.releaseVersion}: ${mode} migrations complete (${patches.length} unique patches).`);
execSync(modeConfig.entry, { cwd: root, stdio: 'inherit', shell: true, env: process.env });

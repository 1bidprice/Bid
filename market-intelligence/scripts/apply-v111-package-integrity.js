import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'config/runtime-release-manifest.json');

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.format !== 'investor-control-runtime-release-manifest' || manifest.version !== 1) {
  throw new Error('package integrity failed: invalid runtime release manifest');
}
if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(String(manifest.releaseVersion || ''))) {
  throw new Error('package integrity failed: invalid releaseVersion');
}

function patchCommand(patches = []) {
  return patches.map((name) => `node scripts/${name}`).join(' && ');
}

const testChain = patchCommand(manifest.testPatches);
const buildChain = patchCommand(manifest.buildPatches);
const entry = manifest.entrypoints || {};

for (const required of ['test', 'run:daily', 'run:autonomous', 'build:mobile', 'build:autonomous-mobile', 'publish:reviewed']) {
  if (!String(entry[required] || '').trim()) throw new Error(`package integrity failed: manifest entrypoint missing ${required}`);
}
for (const requiredPatch of [
  'apply-v110-unified-intelligence.js',
  'apply-v111-package-integrity.js',
  'apply-v126-controlled-plan.js',
  'apply-v127-decision-grade-reference.js',
  'apply-v128-athens-fundamental-passport.js',
  'apply-v129-fundamental-integrity.js',
]) {
  if (!manifest.testPatches.includes(requiredPatch) || !manifest.buildPatches.includes(requiredPatch)) {
    throw new Error(`package integrity failed: current manifest missing ${requiredPatch}`);
  }
}
if (manifest.testPatches[0] !== 'apply-v100-production.js') {
  throw new Error('package integrity failed: production migration must remain first in test/runtime chain');
}
if (manifest.buildPatches.includes('apply-v100-production.js')) {
  throw new Error('package integrity failed: build-only chain must not replay production universe migration');
}

pkg.version = manifest.releaseVersion;
pkg.private = true;
pkg.type = 'module';
pkg.scripts = {
  ...(pkg.scripts || {}),
  test: `${testChain} && ${entry.test}`,
  'run:daily': `${testChain} && ${entry['run:daily']}`,
  'run:autonomous': `${testChain} && ${entry['run:autonomous']}`,
  'build:mobile': `${buildChain} && ${entry['build:mobile']}`,
  'build:autonomous-mobile': `${buildChain} && ${entry['build:autonomous-mobile']}`,
  'publish:reviewed': entry['publish:reviewed'],
};

fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const verified = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (verified.version !== manifest.releaseVersion) throw new Error('package integrity failed: release version mismatch');
for (const [scriptName, patches] of [
  ['test', manifest.testPatches],
  ['run:daily', manifest.testPatches],
  ['run:autonomous', manifest.testPatches],
  ['build:mobile', manifest.buildPatches],
  ['build:autonomous-mobile', manifest.buildPatches],
]) {
  const command = String(verified.scripts?.[scriptName] || '');
  for (const patch of patches) {
    if (!command.includes(`scripts/${patch}`)) throw new Error(`package integrity failed: ${scriptName} missing ${patch}`);
  }
}

console.log(`Investor Control package canonicalized from runtime manifest at v${manifest.releaseVersion}.`);

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'config/runtime-release-manifest.json');
const runnerPath = path.join(root, 'scripts/run-current-release.js');

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.format !== 'investor-control-runtime-release-manifest' || manifest.version !== 1) {
  throw new Error('package integrity failed: invalid runtime release manifest');
}
if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(String(manifest.releaseVersion || ''))) {
  throw new Error('package integrity failed: invalid releaseVersion');
}
if (!fs.existsSync(runnerPath)) throw new Error('package integrity failed: manifest release runner missing');

for (const required of ['test', 'run:daily', 'run:autonomous', 'build:mobile', 'build:autonomous-mobile', 'publish:reviewed']) {
  if (!String(manifest.entrypoints?.[required] || '').trim()) throw new Error(`package integrity failed: manifest entrypoint missing ${required}`);
}
for (const requiredPatch of [
  'apply-v110-unified-intelligence.js',
  'apply-v111-package-integrity.js',
  'apply-v126-controlled-plan.js',
  'apply-v127-decision-grade-reference.js',
  'apply-v128-athens-fundamental-passport.js',
  'apply-v129-fundamental-integrity.js',
  'apply-v1501-universal-compatibility.js',
  'apply-v150-universal-instrument-architecture.js',
  'apply-v151-direct-corroboration.js',
  'apply-v152-capability-engine.js',
  'apply-v153-decision-basis.js',
  'apply-v154-baseline-and-euronext-resolver.js',
  'apply-v155-reviewed-financial-candidates.js',
  'apply-v156-closed-market-reference.js',
  'apply-v157-canonical-issuer-financials.js',
  'apply-v1571-share-note-context.js',
  'apply-v1572-total-revenue-label.js',
  'apply-v1573-note-column-and-authority.js',
  'apply-v158-pdf-glyphs-and-units.js',
  'apply-v1581-context-glyph-normalization.js',
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
for (const [name, patches] of [['testPatches', manifest.testPatches], ['buildPatches', manifest.buildPatches]]) {
  if (!Array.isArray(patches) || patches.some((patch) => typeof patch !== 'string')) throw new Error(`package integrity failed: invalid ${name}`);
  const duplicates = patches.filter((patch, index) => patches.indexOf(patch) !== index);
  if (duplicates.length) throw new Error(`package integrity failed: duplicate ${name}: ${[...new Set(duplicates)].join(', ')}`);
  for (const patch of patches) {
    if (!fs.existsSync(path.join(root, 'scripts', patch))) throw new Error(`package integrity failed: missing patch ${patch}`);
  }
}

pkg.version = manifest.releaseVersion;
pkg.private = true;
pkg.type = 'module';
pkg.scripts = {
  ...(pkg.scripts || {}),
  test: 'node scripts/run-current-release.js test',
  'run:daily': 'node scripts/run-current-release.js run:daily',
  'run:autonomous': 'node scripts/run-current-release.js run:autonomous',
  'build:mobile': 'node scripts/run-current-release.js build:mobile',
  'build:autonomous-mobile': 'node scripts/run-current-release.js build:autonomous-mobile',
  'publish:reviewed': 'node scripts/run-current-release.js publish:reviewed',
};

fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const verified = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (verified.version !== manifest.releaseVersion) throw new Error('package integrity failed: release version mismatch');
for (const name of ['test', 'run:daily', 'run:autonomous', 'build:mobile', 'build:autonomous-mobile', 'publish:reviewed']) {
  if (!String(verified.scripts?.[name] || '').includes('scripts/run-current-release.js')) {
    throw new Error(`package integrity failed: ${name} bypasses manifest runner`);
  }
}

console.log(`Investor Control package canonicalized to manifest runner at v${manifest.releaseVersion}.`);

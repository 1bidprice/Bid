import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const originalVersion = String(pkg.version || '').trim();

if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(originalVersion)) {
  throw new Error(`package integrity failed: invalid version ${originalVersion || '(missing)'}`);
}
if (pkg.private !== true) throw new Error('package integrity failed: package must remain private');
if (pkg.type !== 'module') throw new Error('package integrity failed: package type must remain module');

const requiredCorePatches = [
  'apply-v100-provider-refinements.js',
  'apply-v100-event-integrity.js',
  'apply-v100-feed-health.js',
  'apply-v110-unified-intelligence.js',
  'apply-v111-package-integrity.js',
  'apply-v122-athens-trading-directory.js',
  'apply-v123-athens-directory-pagination.js',
  'apply-v124-athens-directory-all-filter.js',
  'apply-v125-athens-letter-resolution.js',
  'apply-v126-controlled-plan.js',
  'apply-v127-decision-grade-reference.js',
  'apply-v128-athens-fundamental-passport.js',
];

const scriptNames = ['test', 'run:daily', 'run:autonomous', 'build:mobile', 'build:autonomous-mobile'];
for (const scriptName of scriptNames) {
  const command = String(pkg.scripts?.[scriptName] || '');
  if (!command) throw new Error(`package integrity failed: missing ${scriptName}`);
  for (const patch of requiredCorePatches) {
    if (patch === 'apply-v100-production.js' && scriptName.startsWith('build:')) continue;
    if (!command.includes(patch)) throw new Error(`package integrity failed: ${scriptName} missing ${patch}`);
  }
}

const publishReviewed = String(pkg.scripts?.['publish:reviewed'] || '');
if (!publishReviewed.includes('publish-reviewed-research.js')) {
  throw new Error('package integrity failed: reviewed publication command missing');
}

// This integrity layer is deliberately read-only. Newer release scripts own the
// package version and append their migrations. A historical integrity check must
// never downgrade the package or erase later patches from the command chain.
const verified = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (String(verified.version) !== originalVersion) throw new Error('package integrity failed: version mutated during verification');
for (const scriptName of scriptNames) {
  if (String(verified.scripts?.[scriptName] || '') !== String(pkg.scripts?.[scriptName] || '')) {
    throw new Error(`package integrity failed: ${scriptName} mutated during verification`);
  }
}

console.log(`Investor Control package integrity verified without mutation at v${originalVersion}.`);

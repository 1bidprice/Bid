import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const chain = 'node scripts/apply-v100-production.js && node scripts/apply-v100-provider-refinements.js && node scripts/apply-v100-event-integrity.js && node scripts/apply-v100-feed-health.js && node scripts/apply-v110-unified-intelligence.js && node scripts/apply-v111-package-integrity.js && node scripts/apply-v122-athens-trading-directory.js && node scripts/apply-v123-athens-directory-pagination.js && node scripts/apply-v124-athens-directory-all-filter.js && node scripts/apply-v125-athens-letter-resolution.js && node scripts/apply-v126-controlled-plan.js && node scripts/apply-v127-decision-grade-reference.js';
const buildChain = 'node scripts/apply-v100-provider-refinements.js && node scripts/apply-v100-event-integrity.js && node scripts/apply-v100-feed-health.js && node scripts/apply-v110-unified-intelligence.js && node scripts/apply-v111-package-integrity.js && node scripts/apply-v122-athens-trading-directory.js && node scripts/apply-v123-athens-directory-pagination.js && node scripts/apply-v124-athens-directory-all-filter.js && node scripts/apply-v125-athens-letter-resolution.js && node scripts/apply-v126-controlled-plan.js && node scripts/apply-v127-decision-grade-reference.js';

pkg.version = '1.2.7';
pkg.private = true;
pkg.type = 'module';
pkg.scripts = {
  test: `${chain} && node --test`,
  'run:daily': `${chain} && node src/run-daily-intelligence.js out/daily-intelligence.json`,
  'run:autonomous': `${chain} && node src/run-autonomous-intelligence.js out/autonomous-intelligence.json`,
  'build:mobile': `${buildChain} && node src/build-mobile-feed.js out/daily-intelligence.json out/mobile-intelligence-feed.json`,
  'build:autonomous-mobile': `${buildChain} && node src/build-mobile-feed.js out/autonomous-intelligence.json out/mobile-intelligence-feed.json`,
  'publish:reviewed': 'node src/publish-reviewed-research.js out/daily-intelligence.json config/review-decisions.json out/reviewed-publication.json',
};

fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const verified = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
for (const scriptName of ['test', 'run:autonomous', 'build:autonomous-mobile']) {
  const command = String(verified.scripts?.[scriptName] || '');
  for (const patch of [
    'apply-v111-package-integrity.js',
    'apply-v122-athens-trading-directory.js',
    'apply-v123-athens-directory-pagination.js',
    'apply-v124-athens-directory-all-filter.js',
    'apply-v125-athens-letter-resolution.js',
    'apply-v126-controlled-plan.js',
    'apply-v127-decision-grade-reference.js',
  ]) {
    if (!command.includes(patch)) throw new Error(`package integrity failed: ${scriptName} ${patch}`);
  }
}
if (verified.version !== '1.2.7') throw new Error('package integrity failed: version');
console.log('Investor Control market intelligence v1.2.7 package integrity restored.');

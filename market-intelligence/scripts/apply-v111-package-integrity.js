import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

pkg.version = '1.1.0';
pkg.private = true;
pkg.type = 'module';
pkg.scripts = {
  test: 'node scripts/apply-v100-production.js && node scripts/apply-v100-provider-refinements.js && node scripts/apply-v100-event-integrity.js && node scripts/apply-v100-feed-health.js && node scripts/apply-v110-unified-intelligence.js && node scripts/apply-v111-package-integrity.js && node --test',
  'run:daily': 'node scripts/apply-v100-production.js && node scripts/apply-v100-provider-refinements.js && node scripts/apply-v100-event-integrity.js && node scripts/apply-v100-feed-health.js && node scripts/apply-v110-unified-intelligence.js && node scripts/apply-v111-package-integrity.js && node src/run-daily-intelligence.js out/daily-intelligence.json',
  'run:autonomous': 'node scripts/apply-v100-production.js && node scripts/apply-v100-provider-refinements.js && node scripts/apply-v100-event-integrity.js && node scripts/apply-v100-feed-health.js && node scripts/apply-v110-unified-intelligence.js && node scripts/apply-v111-package-integrity.js && node src/run-autonomous-intelligence.js out/autonomous-intelligence.json',
  'build:mobile': 'node scripts/apply-v100-provider-refinements.js && node scripts/apply-v100-event-integrity.js && node scripts/apply-v100-feed-health.js && node scripts/apply-v110-unified-intelligence.js && node scripts/apply-v111-package-integrity.js && node src/build-mobile-feed.js out/daily-intelligence.json out/mobile-intelligence-feed.json',
  'build:autonomous-mobile': 'node scripts/apply-v100-provider-refinements.js && node scripts/apply-v100-event-integrity.js && node scripts/apply-v100-feed-health.js && node scripts/apply-v110-unified-intelligence.js && node scripts/apply-v111-package-integrity.js && node src/build-mobile-feed.js out/autonomous-intelligence.json out/mobile-intelligence-feed.json',
  'publish:reviewed': 'node src/publish-reviewed-research.js out/daily-intelligence.json config/review-decisions.json out/reviewed-publication.json',
};

fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const verified = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
for (const scriptName of ['test', 'run:autonomous', 'build:autonomous-mobile']) {
  if (!String(verified.scripts?.[scriptName] || '').includes('apply-v111-package-integrity.js')) {
    throw new Error(`v1.1 package integrity failed: ${scriptName}`);
  }
}
if (verified.version !== '1.1.0') throw new Error('v1.1 package integrity failed: version');
console.log('Investor Control market intelligence v1.1.0 package integrity restored.');

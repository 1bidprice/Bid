import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const universePath = path.join(root, 'config/universe.seed.json');
const universe = JSON.parse(fs.readFileSync(universePath, 'utf8'));

for (const company of universe) {
  if (company.companyId === 'company:allwyn-ag') {
    company.marketData = {
      ...(company.marketData || {}),
      euronextInstrumentUrl: 'https://athens.euronext.com/en/market-data/instruments/stocks/ALWN/related',
    };
  }
  if (company.companyId === 'company:crediabank') {
    company.marketData = {
      ...(company.marketData || {}),
      euronextInstrumentUrl: 'https://athens.euronext.com/en/market-data/instruments/stocks/CREDIA/related',
    };
  }
}

fs.writeFileSync(universePath, `${JSON.stringify(universe, null, 2)}\n`);

const packagePath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const productionChain = 'node scripts/apply-v100-production.js && node scripts/apply-v100-provider-refinements.js && node scripts/apply-v100-feed-health.js';
pkg.scripts.test = `${productionChain} && node --test`;
pkg.scripts['run:daily'] = `${productionChain} && node src/run-daily-intelligence.js out/daily-intelligence.json`;
pkg.scripts['run:autonomous'] = `${productionChain} && node src/run-autonomous-intelligence.js out/autonomous-intelligence.json`;
pkg.scripts['build:mobile'] = 'node scripts/apply-v100-provider-refinements.js && node scripts/apply-v100-feed-health.js && node src/build-mobile-feed.js out/daily-intelligence.json out/mobile-intelligence-feed.json';
pkg.scripts['build:autonomous-mobile'] = 'node scripts/apply-v100-provider-refinements.js && node scripts/apply-v100-feed-health.js && node src/build-mobile-feed.js out/autonomous-intelligence.json out/mobile-intelligence-feed.json';
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('Investor Control v1.0.0 provider refinements and production script chain applied.');

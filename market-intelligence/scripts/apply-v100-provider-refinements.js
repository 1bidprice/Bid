import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'config/universe.seed.json');
const universe = JSON.parse(fs.readFileSync(file, 'utf8'));

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

fs.writeFileSync(file, `${JSON.stringify(universe, null, 2)}\n`);
console.log('Investor Control v1.0.0 provider endpoint refinements applied.');

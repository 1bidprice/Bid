import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, v) => fs.writeFileSync(path.join(root, p), v);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.5.0.1 universal compatibility failed: missing ${label}`);
  return content.replace(from, to);
}

function patchBankShareBasis() {
  let source = read('src/fundamental-risk.js');
  source = replaceRequired(
    source,
    `  const bankSharesOutstanding = latestValue(bankPassport?.facts?.sharesOutstanding);
  const bankEquity = latestValue(bankPassport?.facts?.equity) ?? equity;
  const bankMarketCap = price !== null && bankSharesOutstanding !== null ? price * bankSharesOutstanding : null;`,
    `  const bankPeriodEndShares = latestValue(bankPassport?.facts?.sharesOutstanding);
  const bankWeightedAverageShares = latestValue(bankPassport?.facts?.dilutedShares) ?? dilutedShares;
  const bankSharesOutstanding = bankPeriodEndShares ?? bankWeightedAverageShares;
  const bankShareBasis = bankPeriodEndShares !== null
    ? 'PERIOD_END_OUTSTANDING'
    : bankWeightedAverageShares !== null
      ? 'DILUTED_WEIGHTED_AVERAGE_APPROXIMATION'
      : 'UNAVAILABLE';
  const bankEquity = latestValue(bankPassport?.facts?.equity) ?? equity;
  const bankMarketCap = price !== null && bankSharesOutstanding !== null ? price * bankSharesOutstanding : null;`,
    'bank share-basis hierarchy',
  );
  source = replaceRequired(
    source,
    `        sharesOutstanding: bankSharesOutstanding,
        equity: bankEquity,`,
    `        sharesOutstanding: bankSharesOutstanding,
        shareBasis: bankShareBasis,
        priceToBookApproximate: bankShareBasis === 'DILUTED_WEIGHTED_AVERAGE_APPROXIMATION',
        equity: bankEquity,`,
    'bank valuation share-basis disclosure',
  );
  write('src/fundamental-risk.js', source);
}

function removeTickerSpecificOrchestratorState() {
  let source = read('src/run-daily-intelligence.js');
  source = source.replace(/^import[^\n]*fetchAllwynRegulatoryAnnouncements[^\n]*\n/m, '');
  source = source.replace(/const\s+POSITION_COMPANY_IDS\s*=\s*new Set\([^\n]+\);\n?/, '');
  write('src/run-daily-intelligence.js', source);
}

patchBankShareBasis();
removeTickerSpecificOrchestratorState();

const risk = read('src/fundamental-risk.js');
for (const invariant of [
  'bankPeriodEndShares',
  'bankWeightedAverageShares',
  "shareBasis: bankShareBasis",
  "priceToBookApproximate: bankShareBasis === 'DILUTED_WEIGHTED_AVERAGE_APPROXIMATION'",
]) {
  if (!risk.includes(invariant)) throw new Error(`v1.5.0.1 risk verification failed: missing ${invariant}`);
}
const daily = read('src/run-daily-intelligence.js');
if (/const\s+POSITION_COMPANY_IDS\b/.test(daily)) throw new Error('v1.5.0.1 orchestrator still defines hardcoded position IDs');
if (/^import[^\n]*fetchAllwynRegulatoryAnnouncements/m.test(daily)) throw new Error('v1.5.0.1 orchestrator still imports issuer-specific Allwyn adapter');

console.log('Investor Control v1.5.0.1 universal compatibility and bank share-basis integrity applied.');
await import('./apply-v150-universal-instrument-architecture.js');
await import('./apply-v151-direct-corroboration.js');
await import('./apply-v152-capability-engine.js');

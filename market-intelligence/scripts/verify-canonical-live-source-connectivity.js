import fs from 'node:fs';
import path from 'node:path';

const feedPath = path.resolve(process.argv[2] || 'out/mobile-intelligence-feed.json');
const auditPath = path.resolve(process.argv[3] || 'out/source-connectivity-audit.json');
const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));

function fail(message) {
  throw new Error(`CANONICAL_LIVE_SOURCE_REJECTED: ${message}`);
}

function isoMs(value, label) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) fail(`${label} is not a valid timestamp`);
  return parsed;
}

function requireServerCredential(name) {
  if (!String(process.env[name] || '').trim()) fail(`server-side credential missing: ${name}`);
}

requireServerCredential('FINNHUB_TOKEN');
requireServerCredential('TWELVE_DATA_API_KEY');

if (feed.format !== 'investor-control-mobile-intelligence-feed' || feed.version !== 2) {
  fail('unexpected mobile intelligence feed contract');
}

const generatedAtMs = isoMs(feed.generatedAt, 'feed.generatedAt');
if (Math.abs(Date.now() - generatedAtMs) > 60 * 60 * 1000) fail('generated feed is older than one hour');

const registry = feed.quoteRegistry;
if (!registry || Array.isArray(registry) || typeof registry !== 'object') fail('canonical quote registry missing');

const required = ['ALWN.GR', 'CREDIA.GR', 'SPCE.US'];
for (const symbol of required) {
  if (!registry[symbol]) fail(`required regression quote missing: ${symbol}`);
}

const audit = {
  format: 'investor-control-canonical-live-source-connectivity-audit',
  version: 1,
  generatedAt: new Date().toISOString(),
  feedGeneratedAt: feed.generatedAt,
  sourcePolicyVersion: feed.sourceSelection?.version || null,
  requiredInstruments: {},
  registryQuoteCount: Object.keys(registry).length,
  eligibleFallbackCount: 0,
};

for (const [symbol, quote] of Object.entries(registry)) {
  const contract = quote?.quoteContract;
  if (!contract) fail(`quote contract missing: ${symbol}`);
  if (quote.appSymbol !== symbol) fail(`app symbol mismatch: ${symbol}`);
  if (!Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0) fail(`invalid price: ${symbol}`);
  if (!quote.currency) fail(`currency missing: ${symbol}`);
  if (!quote.source || !quote.sourceUrl) fail(`source provenance missing: ${symbol}`);
  if (!contract.sourceApproved) fail(`unapproved source entered canonical registry: ${symbol}`);

  const checkedAtMs = isoMs(quote.checkedAt, `${symbol}.checkedAt`);
  const quoteAtMs = isoMs(quote.quoteAt, `${symbol}.quoteAt`);
  if (quoteAtMs > checkedAtMs + 5 * 60 * 1000) fail(`provider timestamp is after retrieval time: ${symbol}`);

  if (contract.sourceRole === 'FALLBACK_UNVERIFIED') {
    if (contract.valuationEligible || contract.analysisReferenceEligible || contract.executionFreshnessEligible || contract.decisionEligible) {
      audit.eligibleFallbackCount += 1;
      fail(`unverified fallback became eligible: ${symbol}`);
    }
  }
}

function validateAthens(symbol) {
  const quote = registry[symbol];
  const contract = quote.quoteContract;
  if (quote.currency !== 'EUR') fail(`${symbol} must remain EUR`);
  if (contract.sourceRole !== 'PRIMARY_EXCHANGE') fail(`${symbol} is not sourced from the primary exchange`);
  if (!/^https:\/\/athens\.euronext\.com\//i.test(quote.sourceUrl)) fail(`${symbol} source URL is not official Euronext Athens`);

  if (contract.timestampVerified !== true) {
    if (contract.decisionEligible || contract.executionFreshnessEligible || contract.dayChangeEligible) {
      fail(`${symbol} unverified exchange timestamp leaked into decision/execution/day-change eligibility`);
    }
  }

  if (String(quote.sourceQuality || '').toUpperCase().includes('DELAYED')) {
    if (Number(contract.advertisedDelayMinutes || 0) < 15) fail(`${symbol} delayed quote does not disclose the official delay`);
    if (contract.decisionEligible || contract.executionFreshnessEligible) fail(`${symbol} delayed quote became execution/decision eligible`);
  }

  audit.requiredInstruments[symbol] = {
    market: 'GR',
    source: quote.source,
    sourceUrl: quote.sourceUrl,
    sourceRole: contract.sourceRole,
    sourceApproved: contract.sourceApproved,
    sourceQuality: quote.sourceQuality || null,
    quoteAt: quote.quoteAt,
    checkedAt: quote.checkedAt,
    timestampVerified: contract.timestampVerified,
    advertisedDelayMinutes: contract.advertisedDelayMinutes ?? null,
    valuationEligible: contract.valuationEligible,
    decisionEligible: contract.decisionEligible,
    executionFreshnessEligible: contract.executionFreshnessEligible,
  };
}

function validateUs(symbol) {
  const quote = registry[symbol];
  const contract = quote.quoteContract;
  if (quote.currency !== 'USD') fail(`${symbol} must remain USD`);
  if (contract.sourceRole !== 'LICENSED_MARKET_DATA') fail(`${symbol} is not using the approved US market-data role`);
  if (!/^https:\/\/finnhub\.io\/api\/v1\/quote\?/i.test(quote.sourceUrl)) fail(`${symbol} is not using the configured primary US quote provider`);
  if (contract.timestampVerified !== true) fail(`${symbol} provider timestamp is not verified`);
  if (!contract.valuationEligible) fail(`${symbol} verified quote is not valuation eligible`);

  audit.requiredInstruments[symbol] = {
    market: 'US',
    source: quote.source,
    sourceUrl: quote.sourceUrl.replace(/([?&](?:token|api_key)=)[^&]+/gi, '$1[REDACTED]'),
    sourceRole: contract.sourceRole,
    sourceApproved: contract.sourceApproved,
    quoteAt: quote.quoteAt,
    checkedAt: quote.checkedAt,
    timestampVerified: contract.timestampVerified,
    marketSessionState: contract.marketSessionState || null,
    valuationEligible: contract.valuationEligible,
    decisionEligible: contract.decisionEligible,
    executionFreshnessEligible: contract.executionFreshnessEligible,
  };
}

validateAthens('ALWN.GR');
validateAthens('CREDIA.GR');
validateUs('SPCE.US');

fs.mkdirSync(path.dirname(auditPath), { recursive: true });
fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(audit, null, 2));

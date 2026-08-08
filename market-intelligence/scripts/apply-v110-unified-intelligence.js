import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.1.0 unified intelligence patch failed: missing ${label}`);
  return content.replace(from, to);
}

function replaceBetween(content, startMarker, endMarker, replacement, label) {
  if (content.includes(replacement)) return content;
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`v1.1.0 unified intelligence patch failed: missing ${label}`);
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}

function patchProfessionalMarketData() {
  let source = read('src/professional-market-data.js');
  source = replaceRequired(
    source,
    "import { calculateMarketMetrics } from './market-metrics.js';",
    "import { calculateMarketMetrics } from './market-metrics.js';\nimport { canonicalizeMarketSnapshot } from './canonical-market-quote.js';",
    'canonical quote import',
  );

  if (!source.includes('function finalizeSnapshotResult(')) {
    source = replaceRequired(
      source,
      'export async function fetchProfessionalMarketSnapshot(company, options = {}) {',
      `function finalizeSnapshotResult(result, company, options = {}) {
  const snapshot = result?.snapshot
    ? canonicalizeMarketSnapshot(result.snapshot, company, options)
    : null;
  const contractDiagnostics = (snapshot?.quoteContract?.diagnosticCodes || []).map((code) => ({
    code,
    companyId: company?.companyId || snapshot?.companyId || null,
    symbol: snapshot?.appSymbol || snapshot?.symbol || company?.primaryListing?.symbol || null,
  }));
  return {
    ...(result || {}),
    snapshot,
    diagnostics: [...(result?.diagnostics || []), ...contractDiagnostics],
  };
}

export async function fetchProfessionalMarketSnapshot(company, options = {}) {`,
      'canonical result finalizer',
    );
  }

  source = replaceRequired(
    source,
    '    return fetchEuronextAthensQuote(company, options);',
    '    return finalizeSnapshotResult(await fetchEuronextAthensQuote(company, options), company, options);',
    'Athens canonical quote routing',
  );
  source = replaceRequired(
    source,
    '      if (primary.snapshot?.usable) return { snapshot: primary.snapshot, diagnostics };',
    '      if (primary.snapshot?.usable) return finalizeSnapshotResult({ snapshot: primary.snapshot, diagnostics }, company, options);',
    'Finnhub canonical quote routing',
  );
  source = replaceRequired(
    source,
    `  return {
    snapshot,
    diagnostics: snapshot?.usable
      ? [...diagnostics, { code: 'MARKET_QUOTE_FALLBACK_USED', companyId: company.companyId }]
      : [...diagnostics, { code: 'MARKET_QUOTE_UNAVAILABLE', companyId: company.companyId }],
  };`,
    `  return finalizeSnapshotResult({
    snapshot,
    diagnostics: snapshot?.usable
      ? [...diagnostics, { code: 'MARKET_QUOTE_FALLBACK_USED', companyId: company.companyId }]
      : [...diagnostics, { code: 'MARKET_QUOTE_UNAVAILABLE', companyId: company.companyId }],
  }, company, options);`,
    'fallback canonical quote routing',
  );
  write('src/professional-market-data.js', source);
}

function patchResearchDossier() {
  let source = read('src/research-dossier.js');
  source = replaceRequired(
    source,
    `function referencePrice(marketSnapshot, historicalMetrics) {
  if (marketSnapshot?.usable && !marketSnapshot.stale && marketSnapshot.currentPrice > 0 && marketSnapshot.quoteAt) {`,
    `function referencePrice(marketSnapshot, historicalMetrics) {
  const quoteContractAllowsDecision = marketSnapshot?.quoteContract
    ? marketSnapshot.quoteContract.decisionEligible === true
    : marketSnapshot?.usable === true;
  if (quoteContractAllowsDecision && !marketSnapshot.stale && marketSnapshot.currentPrice > 0 && marketSnapshot.quoteAt) {`,
    'decision-eligible reference price gate',
  );
  source = replaceRequired(
    source,
    `    evidence: records.map(compactEvidence),
    metrics: {`,
    `    evidence: records.map(compactEvidence),
    marketQuote: input.marketSnapshot || null,
    metrics: {`,
    'market quote retention in dossier',
  );
  write('src/research-dossier.js', source);
}

function patchMobileFeed() {
  let source = read('src/mobile-intelligence-feed.js');
  if (!source.includes('function compactMarketQuote(')) {
    source = replaceRequired(
      source,
      `function ageHours(value, generatedAt) {
  const time = new Date(value).getTime();
  const now = new Date(generatedAt).getTime();
  return Number.isFinite(time) && Number.isFinite(now) ? Math.max(0, (now - time) / 3_600_000) : null;
}
`,
      `function ageHours(value, generatedAt) {
  const time = new Date(value).getTime();
  const now = new Date(generatedAt).getTime();
  return Number.isFinite(time) && Number.isFinite(now) ? Math.max(0, (now - time) / 3_600_000) : null;
}

function compactMarketQuote(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return {
    appSymbol: snapshot.appSymbol || snapshot.symbol || null,
    companyId: snapshot.companyId || null,
    companyName: snapshot.companyName || null,
    price: Number.isFinite(Number(snapshot.currentPrice)) ? Number(snapshot.currentPrice) : null,
    previousClose: Number.isFinite(Number(snapshot.previousClose)) ? Number(snapshot.previousClose) : null,
    currency: snapshot.currency || null,
    quoteAt: snapshot.quoteAt || null,
    checkedAt: snapshot.generatedAt || null,
    source: snapshot.source || null,
    sourceUrl: snapshot.sourceUrl || null,
    sourceQuality: snapshot.sourceQuality || null,
    quoteContract: snapshot.quoteContract || null,
  };
}

function buildQuoteRegistry(snapshots = []) {
  const registry = {};
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const quote = compactMarketQuote(snapshot);
    if (!quote?.appSymbol) continue;
    registry[String(quote.appSymbol).toUpperCase()] = quote;
  }
  return registry;
}
`,
      'market quote compactors',
    );
  }

  source = replaceRequired(
    source,
    `    referencePrice: dossier.referencePrice,
    referencePriceAgeHours: ageHours(dossier.referencePrice?.timestamp, generatedAt),`,
    `    referencePrice: dossier.referencePrice,
    referencePriceAgeHours: ageHours(dossier.referencePrice?.timestamp, generatedAt),
    marketQuote: compactMarketQuote(dossier.marketQuote),`,
    'dossier market quote feed field',
  );

  source = replaceRequired(
    source,
    `    discoveryScore: candidate.discoveryScore,
    status: candidate.status,`,
    `    discoveryScore: candidate.discoveryScore,
    scoreType: 'DISCOVERY_PRIORITY',
    scoreLabel: 'Προτεραιότητα διερεύνησης',
    investmentScore: null,
    status: candidate.status,`,
    'discovery score clarification',
  );

  source = replaceRequired(
    source,
    `  const actionCounts = countFinalActions(dossiers);

  return {`,
    `  const actionCounts = countFinalActions(dossiers);
  const quoteRegistry = buildQuoteRegistry(report.marketSnapshots || []);

  return {`,
    'quote registry construction',
  );

  source = replaceRequired(
    source,
    `    sourceSelection: report.discovery?.sourcePolicy || null,
    operationalHealth:`,
    `    sourceSelection: report.discovery?.sourcePolicy || null,
    quoteRegistry,
    operationalHealth:`,
    'quote registry publication',
  );

  const oldHealth = `    operationalHealth: {
      ...(report.operationalHealth || {}),
      status: (report.historicalMarketMetrics || []).some((item) => item?.readiness?.marketMetricsReady === true) && Number(report.marketSnapshotCount || 0) > 0 ? 'OPERATIONAL' : 'DEGRADED',
      generatedAt: report.operationalHealth?.generatedAt || generatedAt,
      staleOutput: false,
    },`;
  const newHealth = `    operationalHealth: {
      ...(report.operationalHealth || {}),
      status: report.operationalHealth?.status || 'DEGRADED',
      infrastructureStatus: report.operationalHealth?.infrastructureStatus || 'OPERATIONAL',
      marketDataStatus: report.operationalHealth?.marketDataStatus || 'DEGRADED',
      fundamentalsStatus: report.operationalHealth?.fundamentalsStatus || 'DEGRADED',
      researchStatus: report.operationalHealth?.researchStatus || 'ACTIVE',
      decisionEngineStatus: report.operationalHealth?.decisionEngineStatus || (actionCounts.finalActionCount > 0 ? 'READY' : 'BLOCKED_BY_EVIDENCE'),
      generatedAt: report.operationalHealth?.generatedAt || generatedAt,
      staleOutput: false,
    },`;
  source = replaceRequired(source, oldHealth, newHealth, 'honest operational health projection');

  write('src/mobile-intelligence-feed.js', source);
}

function patchAutonomousHealth() {
  let source = read('src/run-autonomous-intelligence.js');
  if (!source.includes('const marketCoverageRatio =')) {
    source = replaceRequired(
      source,
      `  const finalActionCount = Object.entries(finalActionCounts)
    .filter(([key]) => key !== 'BLOCKED')
    .reduce((sum, [, value]) => sum + value, 0);

  return {`,
      `  const finalActionCount = Object.entries(finalActionCounts)
    .filter(([key]) => key !== 'BLOCKED')
    .reduce((sum, [, value]) => sum + value, 0);
  const analysedCompanyCount = Math.max(1, expandedUniverse.length);
  const readyHistoricalCount = (baseReport.historicalMarketMetrics || [])
    .filter((item) => item?.readiness?.marketMetricsReady === true).length;
  const marketCoverageRatio = Number(baseReport.marketSnapshotCount || 0) / analysedCompanyCount;
  const historyCoverageRatio = readyHistoricalCount / analysedCompanyCount;
  const fundamentalCoverageRatio = Number(baseReport.fundamentalSnapshotCount || 0) / analysedCompanyCount;
  const blockedDecisionCount = Number(finalActionCounts.BLOCKED || 0);
  const systemStatus = marketCoverageRatio >= 0.9 && historyCoverageRatio >= 0.9 && fundamentalCoverageRatio >= 0.8
    ? 'OPERATIONAL'
    : 'DEGRADED';

  return {`,
      'coverage-aware health calculations',
    );
  }

  const healthBlock = `    operationalHealth: {
      status: systemStatus,
      infrastructureStatus: 'OPERATIONAL',
      marketDataStatus: marketCoverageRatio >= 0.9 && historyCoverageRatio >= 0.9 ? 'OPERATIONAL' : 'DEGRADED',
      fundamentalsStatus: fundamentalCoverageRatio >= 0.8 ? 'OPERATIONAL' : 'DEGRADED',
      researchStatus: researchDossiers.length > 0 ? 'ACTIVE' : 'IDLE',
      decisionEngineStatus: finalActionCount > 0 ? 'READY' : blockedDecisionCount > 0 ? 'BLOCKED_BY_EVIDENCE' : 'IDLE',
      generatedAt,
      analysedCompanyCount,
      marketSnapshotCount: baseReport.marketSnapshotCount,
      marketCoverageRatio: Number(marketCoverageRatio.toFixed(4)),
      historicalMarketMetricsCount: baseReport.historicalMarketMetricsCount,
      readyHistoricalMarketMetricsCount: readyHistoricalCount,
      historyCoverageRatio: Number(historyCoverageRatio.toFixed(4)),
      fundamentalSnapshotCount: baseReport.fundamentalSnapshotCount,
      fundamentalCoverageRatio: Number(fundamentalCoverageRatio.toFixed(4)),
      unresolvedDiagnosticCount: baseReport.diagnostics.length + (discovery.diagnostics?.length || 0),
      finalActionCount,
      blockedDecisionCount,
      staleOutput: false,
    },
`;
  source = replaceBetween(
    source,
    '    operationalHealth: {',
    '    autonomousPublicationCount:',
    healthBlock,
    'coverage-aware operational health block',
  );
  source = source.replace('    version: 7,', '    version: 8,');
  write('src/run-autonomous-intelligence.js', source);
}

function patchSchema() {
  const file = path.join(root, 'schemas/mobile-intelligence-feed.schema.json');
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!schema.required.includes('quoteRegistry')) {
    schema.required.splice(schema.required.indexOf('summary'), 0, 'quoteRegistry');
  }
  schema.properties.quoteRegistry = {
    type: 'object',
    additionalProperties: {
      type: 'object',
      additionalProperties: true,
      required: ['appSymbol', 'price', 'currency', 'quoteAt', 'source', 'quoteContract'],
      properties: {
        appSymbol: { type: 'string' },
        companyId: { type: ['string', 'null'] },
        companyName: { type: ['string', 'null'] },
        price: { type: ['number', 'null'] },
        previousClose: { type: ['number', 'null'] },
        currency: { type: ['string', 'null'] },
        quoteAt: { type: ['string', 'null'] },
        checkedAt: { type: ['string', 'null'] },
        source: { type: ['string', 'null'] },
        sourceUrl: { type: ['string', 'null'] },
        sourceQuality: { type: ['string', 'null'] },
        quoteContract: { type: ['object', 'null'] },
      },
    },
  };

  const discovery = schema.$defs.discoveryItem;
  for (const key of ['scoreType', 'scoreLabel', 'investmentScore']) {
    if (!discovery.required.includes(key)) discovery.required.splice(discovery.required.indexOf('status'), 0, key);
  }
  discovery.properties.scoreType = { const: 'DISCOVERY_PRIORITY' };
  discovery.properties.scoreLabel = { type: 'string' };
  discovery.properties.investmentScore = { type: 'null' };

  const feedItem = schema.$defs.feedItem;
  if (!feedItem.required.includes('marketQuote')) {
    feedItem.required.splice(feedItem.required.indexOf('thesis'), 0, 'marketQuote');
  }
  feedItem.properties.marketQuote = { type: ['object', 'null'] };

  if (schema.properties.operationalHealth?.properties) {
    Object.assign(schema.properties.operationalHealth.properties, {
      infrastructureStatus: { type: 'string' },
      marketDataStatus: { type: 'string' },
      fundamentalsStatus: { type: 'string' },
      researchStatus: { type: 'string' },
      decisionEngineStatus: { type: 'string' },
    });
  }

  fs.writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
}

patchProfessionalMarketData();
patchResearchDossier();
patchMobileFeed();
patchAutonomousHealth();
patchSchema();

console.log('Investor Control v1.1.0 unified source, quote and health contracts applied.');

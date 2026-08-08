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
  if (!content.includes(from)) throw new Error(`v1.0.0 production patch failed: missing ${label}`);
  return content.replace(from, to);
}

function replaceBetween(content, startMarker, endMarker, replacement, label) {
  if (content.includes(replacement)) return content;
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`v1.0.0 production patch failed: missing ${label}`);
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}

function patchDailyPipeline() {
  let source = read('src/run-daily-intelligence.js');
  source = replaceRequired(
    source,
    "import { fetchFinnhubQuote } from './adapters/finnhub-quote.js';\nimport { fetchFinnhubCandlesForSymbol, fetchFinnhubCompanyCandles } from './adapters/finnhub-candles.js';",
    "import { fetchProfessionalMarketSnapshot, fetchProfessionalHistoricalMetrics } from './professional-market-data.js';",
    'professional market imports',
  );
  source = replaceRequired(
    source,
    "import { fetchAllwynRegulatoryAnnouncements } from './adapters/allwyn-regulatory.js';",
    "import { fetchAllwynRegulatoryAnnouncements } from './adapters/allwyn-regulatory.js';\nimport { fetchEuronextAthensAnnouncements } from './adapters/euronext-athens-announcements.js';",
    'Euronext announcements import',
  );
  source = source.replace(
    "const POSITION_COMPANY_IDS = new Set(['company:allwyn-ag', 'company:virgin-galactic-holdings']);",
    "const POSITION_COMPANY_IDS = new Set(['company:allwyn-ag', 'company:virgin-galactic-holdings', 'company:crediabank']);",
  );
  source = replaceRequired(
    source,
    "    dailyChangePct: snapshot.dailyChangePct,\n  };",
    "    dailyChangePct: snapshot.dailyChangePct,\n    sourceQuality: snapshot.sourceQuality || null,\n    quoteTimestampVerified: snapshot.quoteTimestampVerified !== false,\n    timestampMeaning: snapshot.timestampMeaning || null,\n  };",
    'market source quality summary',
  );
  source = replaceRequired(
    source,
    "    relativeStrength: metrics.relativeStrength,\n    readiness: metrics.readiness,",
    "    relativeStrength: metrics.relativeStrength,\n    dataQuality: metrics.dataQuality || null,\n    readiness: metrics.readiness,",
    'historical data-quality summary',
  );
  source = replaceRequired(
    source,
    "  if (company.companyId === 'company:allwyn-ag') {\n    return fetchAllwynRegulatoryAnnouncements(company, {\n      fetchImpl: options.fetchImpl,\n      retrievedAt: options.now,\n      limit: options.limit,\n    });\n  }\n\n  return {",
    "  if (company.companyId === 'company:allwyn-ag') {\n    return fetchAllwynRegulatoryAnnouncements(company, {\n      fetchImpl: options.fetchImpl,\n      retrievedAt: options.now,\n      limit: options.limit,\n    });\n  }\n\n  if (company.marketData?.euronextIssuerAnnouncementsUrl) {\n    return fetchEuronextAthensAnnouncements(company, {\n      fetchImpl: options.fetchImpl,\n      retrievedAt: options.now,\n      limit: options.limit,\n    });\n  }\n\n  return {",
    'generic Athens evidence route',
  );

  const marketFunction = `async function collectCompanyMarketSnapshot(company, options) {
  return fetchProfessionalMarketSnapshot(company, {
    fetchImpl: options.fetchImpl,
    token: options.finnhubToken,
    generatedAt: options.now,
  });
}`;
  source = replaceBetween(
    source,
    'async function collectCompanyMarketSnapshot(company, options) {',
    '\n\nasync function collectCompanyHistoricalMetrics(company, options) {',
    marketFunction,
    'market snapshot function',
  );

  const historyFunction = `async function collectCompanyHistoricalMetrics(company, options) {
  return fetchProfessionalHistoricalMetrics(company, {
    fetchImpl: options.fetchImpl,
    token: options.finnhubToken,
    generatedAt: options.now,
    lookbackDays: options.lookbackDays,
    benchmarkCache: options.benchmarkCache,
    marketSnapshot: options.marketSnapshot,
    historyCrossCheckTolerancePct: options.historyCrossCheckTolerancePct,
  });
}`;
  source = replaceBetween(
    source,
    'async function collectCompanyHistoricalMetrics(company, options) {',
    '\n\nasync function analyseEvidenceDocument(',
    historyFunction,
    'historical market function',
  );
  source = replaceRequired(
    source,
    "        benchmarkCache,\n      });",
    "        benchmarkCache,\n        marketSnapshot,\n        historyCrossCheckTolerancePct: options.historyCrossCheckTolerancePct,\n      });",
    'market snapshot history cross-check input',
  );
  source = source.replace(/Investor-Control-Market-Intelligence\/0\.5/g, 'Investor-Control-Market-Intelligence/1.0');
  source = source.replace("    version: 4,", "    version: 5,");
  write('src/run-daily-intelligence.js', source);
}

function patchMarketMetrics() {
  let source = read('src/market-metrics.js');
  if (!source.includes('function tradingDateKey(')) {
    source = replaceRequired(
      source,
      'function alignedReturn(companyCandles, benchmarkCandles, periods) {',
      `function tradingDateKey(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function alignedReturn(companyCandles, benchmarkCandles, periods) {`,
      'trading-date alignment helper',
    );
  }
  source = replaceRequired(
    source,
    '  const companyMap = new Map(companyCandles.map((item) => [item.timestamp, item.close]));\n  const aligned = benchmarkCandles\n    .filter((item) => companyMap.has(item.timestamp))\n    .map((item) => ({ timestamp: item.timestamp, company: companyMap.get(item.timestamp), benchmark: item.close }));',
    "  const companyMap = new Map(companyCandles.map((item) => [tradingDateKey(item.timestamp), item.close]).filter(([key]) => key));\n  const aligned = benchmarkCandles\n    .map((item) => ({ ...item, tradingDate: tradingDateKey(item.timestamp) }))\n    .filter((item) => item.tradingDate && companyMap.has(item.tradingDate))\n    .map((item) => ({ timestamp: item.timestamp, company: companyMap.get(item.tradingDate), benchmark: item.close }));",
    'cross-provider date alignment',
  );
  source = replaceRequired(
    source,
    '  const marketMetricsReady = priceHistoryReady && liquidityReady && relativeStrengthReady;',
    "  const sourceReady = options.sourceReady === true;\n  const crossCheckReady = options.crossCheckReady === true;\n  const benchmarkReady = options.benchmarkReady !== false;\n  const marketMetricsReady = priceHistoryReady && liquidityReady && relativeStrengthReady && sourceReady && crossCheckReady && benchmarkReady;",
    'data-quality readiness gate',
  );
  source = source.replace("    version: 1,", "    version: 2,");
  source = replaceRequired(
    source,
    "      : null,\n    readiness: {\n      priceHistoryReady,",
    "      : null,\n    dataQuality: {\n      sourceReady,\n      crossCheckReady,\n      benchmarkReady,\n      historySource: options.historySource || series?.source || null,\n      historySourceQuality: options.historySourceQuality || series?.sourceQuality || null,\n      benchmarkSource: options.benchmarkSource || benchmarkSeries?.source || null,\n      validation: options.validation || null,\n    },\n    readiness: {\n      priceHistoryReady,",
    'data-quality output',
  );
  source = replaceRequired(
    source,
    '      relativeStrengthReady,\n      marketMetricsReady,',
    '      relativeStrengthReady,\n      sourceReady,\n      crossCheckReady,\n      benchmarkReady,\n      marketMetricsReady,',
    'readiness detail',
  );
  write('src/market-metrics.js', source);
}

function patchFinalActionPolicy() {
  let source = read('src/final-action-policy.js');
  source = source.replace("export const FINAL_ACTION_POLICY_VERSION = '2026-07-27.1';", "export const FINAL_ACTION_POLICY_VERSION = '2026-07-30.1';");
  source = source.replace("    version: 1,", "    version: 2,");
  source = replaceRequired(
    source,
    "  if (market?.readiness?.marketMetricsReady !== true) blockers.push('MARKET_METRICS_NOT_READY');",
    "  if (market?.readiness?.marketMetricsReady !== true) blockers.push('MARKET_METRICS_NOT_READY');\n  if (market?.dataQuality?.sourceReady !== true) blockers.push('MARKET_HISTORY_SOURCE_NOT_READY');\n  if (market?.dataQuality?.crossCheckReady !== true) blockers.push('MARKET_HISTORY_NOT_CROSSCHECKED');\n  if (market?.dataQuality?.benchmarkReady !== true) blockers.push('MARKET_BENCHMARK_NOT_READY');",
    'explicit market data blockers',
  );
  write('src/final-action-policy.js', source);
}

function patchAutonomousHealth() {
  let source = read('src/run-autonomous-intelligence.js');
  source = source.replace('    version: 6,', '    version: 7,');
  source = replaceRequired(
    source,
    "    finalActionCounts,\n    autonomousPublicationCount:",
    "    finalActionCounts,\n    operationalHealth: {\n      status: baseReport.historicalMarketMetricsCount > 0 && baseReport.marketSnapshotCount > 0 ? 'OPERATIONAL' : 'DEGRADED',\n      generatedAt,\n      analysedCompanyCount: expandedUniverse.length,\n      marketSnapshotCount: baseReport.marketSnapshotCount,\n      historicalMarketMetricsCount: baseReport.historicalMarketMetricsCount,\n      fundamentalSnapshotCount: baseReport.fundamentalSnapshotCount,\n      unresolvedDiagnosticCount: baseReport.diagnostics.length + (discovery.diagnostics?.length || 0),\n      finalActionCount,\n      staleOutput: false,\n    },\n    autonomousPublicationCount:",
    'operational health output',
  );
  write('src/run-autonomous-intelligence.js', source);
}

function patchUniverse() {
  const file = path.join(root, 'config/universe.seed.json');
  const universe = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map(universe.map((company) => [company.companyId, company]));
  const allwyn = byId.get('company:allwyn-ag');
  if (allwyn) {
    allwyn.marketData = {
      ...(allwyn.marketData || {}),
      yahooSymbols: ['ALWN.AT'],
      benchmarkYahooSymbols: ['GD.AT', 'ATG.AT', '^ATG'],
      euronextInstrumentUrl: 'https://athens.euronext.com/en/market-data/instruments/stocks/ALWN',
    };
  }
  const spce = byId.get('company:virgin-galactic-holdings');
  if (spce) {
    spce.marketData = {
      ...(spce.marketData || {}),
      yahooSymbols: ['SPCE'],
      benchmarkYahooSymbols: ['SPY'],
    };
  }
  if (!byId.has('company:crediabank')) {
    universe.push({
      companyId: 'company:crediabank',
      legalName: 'CrediaBank S.A.',
      displayName: 'CrediaBank',
      primaryListing: { exchange: 'Euronext Athens', symbol: 'CREDIA', mic: 'XATH' },
      listings: [{ exchange: 'Euronext Athens', symbol: 'CREDIA', mic: 'XATH', currency: 'EUR', active: true }],
      isin: 'GRS001003052',
      cik: null,
      lei: null,
      country: 'GR',
      currency: 'EUR',
      sector: 'Financials',
      industry: 'Banking',
      website: 'https://www.crediabank.com/',
      investorRelationsUrl: 'https://www.crediabank.com/en/group/investor-relations/',
      parentCompanyIds: [],
      subsidiaryCompanyIds: [],
      competitorCompanyIds: [],
      relationshipEdges: [],
      marketData: {
        yahooSymbols: ['CREDIA.AT'],
        benchmarkYahooSymbols: ['GD.AT', 'ATG.AT', '^ATG'],
        euronextInstrumentUrl: 'https://athens.euronext.com/en/market-data/instruments/stocks/CREDIA',
        euronextIssuerAnnouncementsUrl: 'https://athens.euronext.com/en/market-data/issuers/50/announcements',
      },
      active: true,
      updatedAt: '2026-07-30T00:00:00.000Z',
    });
  }
  fs.writeFileSync(file, `${JSON.stringify(universe, null, 2)}\n`);
}

function patchPackage() {
  const file = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.version = '1.0.0';
  const apply = 'node scripts/apply-v100-production.js';
  pkg.scripts.test = `${apply} && node --test`;
  pkg.scripts['run:daily'] = `${apply} && node src/run-daily-intelligence.js out/daily-intelligence.json`;
  pkg.scripts['run:autonomous'] = `${apply} && node src/run-autonomous-intelligence.js out/autonomous-intelligence.json`;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchDailyPipeline();
patchMarketMetrics();
patchFinalActionPolicy();
patchAutonomousHealth();
patchUniverse();
patchPackage();

console.log('Investor Control market intelligence v1.0.0 production data pipeline applied.');

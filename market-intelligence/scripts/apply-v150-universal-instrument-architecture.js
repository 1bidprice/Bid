import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, v) => fs.writeFileSync(path.join(root, p), v);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.5.0 universal architecture patch failed: missing ${label}`);
  return content.replace(from, to);
}

function replaceBetween(content, startMarker, endMarker, replacement, label) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`v1.5.0 universal architecture patch failed: missing ${label}`);
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}

function patchDailyPipeline() {
  let source = read('src/run-daily-intelligence.js');

  source = replaceRequired(
    source,
    "import { rankSignalCandidate } from './rank-signal.js';",
    "import { rankSignalCandidate } from './rank-signal.js';\nimport { buildInstrumentProfile } from './instrument-profile.js';\nimport { buildInstrumentRoute } from './instrument-router.js';",
    'instrument router imports',
  );

  // The Euronext adapter is already imported by the production migration. Keep
  // the source robust if a future baseline removes that migration.
  if (!source.includes("fetchEuronextAthensAnnouncements")) {
    source = replaceRequired(
      source,
      "import { fetchSecRecentFilings } from './adapters/sec-submissions.js';",
      "import { fetchSecRecentFilings } from './adapters/sec-submissions.js';\nimport { fetchEuronextAthensAnnouncements } from './adapters/euronext-athens-announcements.js';",
      'Athens announcements import',
    );
  }

  const evidenceFunction = `async function collectCompanyEvidence(company, options) {
  const profile = options.instrumentProfile || buildInstrumentProfile(company);
  const route = options.instrumentRoute || buildInstrumentRoute(company, { profile });
  const adapter = route.routes?.officialEvidence?.adapter || null;

  if (adapter === 'SEC_SUBMISSIONS') {
    return fetchSecRecentFilings(company, {
      fetchImpl: options.fetchImpl,
      userAgent: options.secUserAgent,
      retrievedAt: options.now,
      limit: options.limit,
    });
  }

  if (adapter === 'EURONEXT_ATHENS_ANNOUNCEMENTS') {
    const issuerId = String(company?.issuerId || profile?.identifiers?.issuerId || '').trim();
    const announcementsUrl = company?.marketData?.euronextIssuerAnnouncementsUrl
      || (issuerId ? \`https://athens.euronext.com/en/market-data/issuers/\${encodeURIComponent(issuerId)}/announcements\` : null);
    if (!announcementsUrl) {
      return { records: [], diagnostics: [{ code: 'INSTRUMENT_OFFICIAL_EVIDENCE_IDENTITY_INCOMPLETE', companyId: company.companyId, assetClass: profile.assetClass }] };
    }
    return fetchEuronextAthensAnnouncements({
      ...company,
      marketData: { ...(company.marketData || {}), euronextIssuerAnnouncementsUrl: announcementsUrl },
    }, {
      fetchImpl: options.fetchImpl,
      retrievedAt: options.now,
      limit: options.limit,
      userAgent: options.documentUserAgent,
    });
  }

  return {
    records: [],
    diagnostics: [{
      code: 'INSTRUMENT_OFFICIAL_EVIDENCE_ADAPTER_UNAVAILABLE',
      companyId: company.companyId,
      assetClass: profile.assetClass,
      analysisModel: profile.analysisModel,
      requiredCapabilities: profile.requiredCapabilities,
    }],
  };
}`;

  source = replaceBetween(
    source,
    'async function collectCompanyEvidence(company, options) {',
    '\n\nasync function collectCompanyFundamentals(company, options) {',
    evidenceFunction,
    'capability-routed official evidence function',
  );

  const fundamentalsFunction = `async function collectCompanyFundamentals(company, options) {
  const profile = options.instrumentProfile || buildInstrumentProfile(company);
  const route = options.instrumentRoute || buildInstrumentRoute(company, { profile });
  const adapter = route.routes?.fundamentals?.adapter || null;

  if (adapter === 'SEC_COMPANY_FACTS') {
    return fetchSecCompanyFacts(company, {
      fetchImpl: options.fetchImpl,
      userAgent: options.secUserAgent,
      generatedAt: options.now,
    });
  }
  if (adapter === 'EURONEXT_ATHENS_FINANCIALS') {
    return fetchEuronextAthensFundamentals(company, {
      fetchImpl: options.fetchImpl,
      generatedAt: options.now,
      userAgent: options.documentUserAgent || 'Investor-Control-Market-Intelligence/1.0',
      pdfExtractor: options.pdfExtractor,
      maxBytes: options.maxDocumentBytes,
      minReviewedText: options.minReviewedText,
      timeoutMs: options.pdfTimeoutMs,
    });
  }
  return {
    snapshot: null,
    diagnostics: [{
      code: 'INSTRUMENT_ANALYTICS_PROVIDER_REQUIRED',
      companyId: company.companyId,
      assetClass: profile.assetClass,
      analysisModel: profile.analysisModel,
      requiredCapabilities: profile.requiredCapabilities,
    }],
  };
}`;

  source = replaceBetween(
    source,
    'async function collectCompanyFundamentals(company, options) {',
    '\n\nasync function collectCompanyMarketSnapshot(company, options) {',
    fundamentalsFunction,
    'capability-routed fundamentals function',
  );

  const marketFunction = `async function collectCompanyMarketSnapshot(company, options) {
  const profile = options.instrumentProfile || buildInstrumentProfile(company);
  const route = options.instrumentRoute || buildInstrumentRoute(company, { profile });
  if (!route.routes?.market?.adapter) {
    return { snapshot: null, diagnostics: [{ code: 'INSTRUMENT_MARKET_PROVIDER_REQUIRED', companyId: company.companyId, assetClass: profile.assetClass, analysisModel: profile.analysisModel }] };
  }
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
    'capability-routed market function',
  );

  const historyFunction = `async function collectCompanyHistoricalMetrics(company, options) {
  const profile = options.instrumentProfile || buildInstrumentProfile(company);
  const route = options.instrumentRoute || buildInstrumentRoute(company, { profile });
  if (!route.routes?.history?.adapter) {
    return { series: null, metrics: null, diagnostics: [{ code: 'INSTRUMENT_HISTORY_PROVIDER_REQUIRED', companyId: company.companyId, assetClass: profile.assetClass, analysisModel: profile.analysisModel }] };
  }
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
    'capability-routed history function',
  );

  source = replaceRequired(
    source,
    '  const researchDossiers = [];\n  const documentLimit =',
    '  const researchDossiers = [];\n  const instrumentProfiles = [];\n  const instrumentRoutes = [];\n  const documentLimit =',
    'instrument registry output arrays',
  );

  source = replaceRequired(
    source,
    `    let fundamentalRisk = null;

    try {`,
    `    let fundamentalRisk = null;
    const instrumentProfile = buildInstrumentProfile(company);
    const instrumentRoute = buildInstrumentRoute(company, { profile: instrumentProfile });
    instrumentProfiles.push(instrumentProfile);
    instrumentRoutes.push(instrumentRoute);

    try {`,
    'per-instrument routing state',
  );

  for (const [needle, replacement, label] of [
    ['        secUserAgent,\n        documentUserAgent:', '        secUserAgent,\n        instrumentProfile,\n        instrumentRoute,\n        documentUserAgent:', 'fundamentals route inputs'],
    ['        finnhubToken,\n        now,', '        finnhubToken,\n        instrumentProfile,\n        instrumentRoute,\n        now,', 'market route inputs'],
    ['        finnhubToken,\n        now,\n        lookbackDays:', '        finnhubToken,\n        instrumentProfile,\n        instrumentRoute,\n        now,\n        lookbackDays:', 'history route inputs'],
    ['        secUserAgent,\n        now,\n        limit:', '        secUserAgent,\n        instrumentProfile,\n        instrumentRoute,\n        documentUserAgent: options.documentUserAgent,\n        now,\n        limit:', 'evidence route inputs'],
  ]) {
    if (source.includes(needle)) source = source.replace(needle, replacement);
  }

  source = source.replace(
    '          hasPosition: POSITION_COMPANY_IDS.has(company.companyId),',
    "          hasPosition: options.positionCompanyIds instanceof Set ? options.positionCompanyIds.has(company.companyId) : company?.portfolioContext?.hasPosition === true,",
  );

  source = replaceRequired(
    source,
    `        company,
        generatedAt: now,`,
    `        company,
        instrumentProfile,
        instrumentRoute,
        generatedAt: now,`,
    'dossier instrument passport input',
  );

  source = replaceRequired(
    source,
    `    fundamentalSnapshotCount: fundamentalSnapshots.length,
    fundamentalSnapshots,`,
    `    instrumentProfileCount: instrumentProfiles.length,
    instrumentProfiles,
    instrumentRouteCount: instrumentRoutes.length,
    instrumentRoutes,
    fundamentalSnapshotCount: fundamentalSnapshots.length,
    fundamentalSnapshots,`,
    'report instrument passports',
  );

  write('src/run-daily-intelligence.js', source);
}

function patchResearchDossier() {
  let source = read('src/research-dossier.js');
  source = replaceRequired(
    source,
    `    listing: company.primaryListing || { exchange: 'Unknown', symbol: 'UNKNOWN', mic: null },
    generatedAt,`,
    `    listing: company.primaryListing || { exchange: 'Unknown', symbol: 'UNKNOWN', mic: null },
    instrumentProfile: input.instrumentProfile || null,
    instrumentRoute: input.instrumentRoute || null,
    generatedAt,`,
    'instrument passport on dossier',
  );
  write('src/research-dossier.js', source);
}

patchDailyPipeline();
patchResearchDossier();

for (const [file, invariants] of Object.entries({
  'src/run-daily-intelligence.js': [
    'buildInstrumentProfile',
    'buildInstrumentRoute',
    'INSTRUMENT_ANALYTICS_PROVIDER_REQUIRED',
    'INSTRUMENT_MARKET_PROVIDER_REQUIRED',
    'instrumentProfiles',
    'instrumentRoutes',
    'portfolioContext?.hasPosition',
  ],
  'src/research-dossier.js': ['instrumentProfile: input.instrumentProfile || null', 'instrumentRoute: input.instrumentRoute || null'],
})) {
  const source = read(file);
  for (const invariant of invariants) {
    if (!source.includes(invariant)) throw new Error(`v1.5.0 verification failed: ${file} missing ${invariant}`);
  }
}

console.log('Investor Control v1.5.0 Universal Instrument Architecture applied.');

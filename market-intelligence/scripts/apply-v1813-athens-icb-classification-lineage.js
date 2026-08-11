import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Investor Control v1.8 Athens ICB patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchAthensDiscovery() {
  let source = read('src/adapters/euronext-athens-discovery.js');
  source = replaceRequired(source, "import { contentHash } from '../content-hash.js';", "import { contentHash } from '../content-hash.js';\nimport { fetchAthensIcbClassificationSnapshot } from './euronext-athens-classification.js';", 'Athens classification adapter import');
  source = replaceRequired(source, "export const ATHENS_DISCOVERY_VERSION = '2026-08-05.6';", "export const ATHENS_DISCOVERY_VERSION = '2026-08-11.1';", 'Athens classification discovery policy version');
  source = replaceRequired(source, '    const companies = [];\n    const letterDirectoryCache = new Map();', '    const companies = [];\n    const classificationSnapshots = [];\n    const letterDirectoryCache = new Map();', 'Athens classification snapshot accumulator');
  source = replaceRequired(source, '      companies.push(await resolveCompanySymbol(fetchImpl, company, { ...options, tradingDirectory, letterDirectoryCache }, diagnostics));', `      const resolvedCompany = await resolveCompanySymbol(fetchImpl, company, { ...options, tradingDirectory, letterDirectoryCache }, diagnostics);
      companies.push(resolvedCompany);
      const classificationResult = await fetchAthensIcbClassificationSnapshot(resolvedCompany, {
        fetchImpl,
        capturedAt: generatedAt,
        userAgent: options.userAgent || 'Investor-Control-Market-Intelligence/1.8',
        signal: options.signal,
      });
      if (classificationResult.snapshot) classificationSnapshots.push(classificationResult.snapshot);
      diagnostics.push(...(classificationResult.diagnostics || []));`, 'bounded Athens classification collection');
  source = replaceRequired(source, '      companies,\n      records: announcements.records,', '      companies,\n      classificationSnapshotCount: classificationSnapshots.length,\n      classificationSnapshots,\n      records: announcements.records,', 'Athens classification discovery output');
  source = replaceRequired(source, '      companies: [],\n      records: [],', '      companies: [],\n      classificationSnapshotCount: 0,\n      classificationSnapshots: [],\n      records: [],', 'Athens classification failure output');
  source = source.replaceAll('version: 6,', 'version: 7,');
  write('src/adapters/euronext-athens-discovery.js', source);
}

function patchAutonomousDiscovery() {
  let source = read('src/autonomous-discovery.js');
  source = replaceRequired(source, `    athensActiveIssuerCount: athensResult.companies?.length || 0,
    filingEventCount: recentRecords.length,`, `    athensActiveIssuerCount: athensResult.companies?.length || 0,
    classificationSnapshotCount: athensResult.classificationSnapshots?.length || 0,
    classificationSnapshots: athensResult.classificationSnapshots || [],
    filingEventCount: recentRecords.length,`, 'Athens classification propagation from discovery');
  write('src/autonomous-discovery.js', source);
}

function patchAutonomousRunner() {
  let source = read('src/run-autonomous-intelligence.js');
  source = replaceRequired(source, '  const baseReport = await runDailyIntelligence({ ...options, now: generatedAt, universe: expandedUniverse });', `  const baseReport = await runDailyIntelligence({
    ...options,
    now: generatedAt,
    universe: expandedUniverse,
    classificationSnapshots: discovery.classificationSnapshots || [],
  });`, 'Athens classification seed into daily report');
  write('src/run-autonomous-intelligence.js', source);
}

function patchDailyRunner() {
  let source = read('src/run-daily-intelligence.js');
  source = replaceRequired(source, '  const classificationSnapshots = [];', '  const classificationSnapshots = [...(options.classificationSnapshots || [])];', 'pre-collected classification seed');
  write('src/run-daily-intelligence.js', source);
}

function patchAthensTestFixture() {
  const relativePath = 'test/euronext-athens-discovery.test.js';
  if (!fs.existsSync(path.join(root, relativePath))) return;
  let source = read(relativePath);
  source = replaceRequired(source, `const searchAndro = \`
  <div class="result"><a href="/en/market-data/issuers/410">ALPHA TRUST ANDROMEDA SA</a><a href="/en/market-data/instruments/stocks/ANDRO">ANDRO</a></div>
\`;
`, `const searchAndro = \`
  <div class="result"><a href="/en/market-data/issuers/410">ALPHA TRUST ANDROMEDA SA</a><a href="/en/market-data/instruments/stocks/ANDRO">ANDRO</a></div>
\`;

const profileQuest = \`
  <table><tr><th>Sector / Sub-sector</th><td>Technology / Computer Services</td></tr></table>
\`;

const profileAndro = \`
  <table><tr><th>Sector / Sub-sector</th><td>Financials / Closed End Investments</td></tr></table>
\`;
`, 'Athens classification profile fixtures');
  source = replaceRequired(source, `    if (value.includes('/trading-products/trading-issuers')) throw new Error('directory unavailable in unit fixture');
    if (value.includes('QUEST HOLDINGS')) return { ok: true, text: async () => searchQuest };
    if (value.includes('ALPHA TRUST ANDROMEDA')) return { ok: true, text: async () => searchAndro };`, `    if (value.includes('/trading-products/trading-issuers')) throw new Error('directory unavailable in unit fixture');
    if (value.endsWith('/market-data/issuers/623')) return { ok: true, text: async () => profileQuest };
    if (value.endsWith('/market-data/issuers/410')) return { ok: true, text: async () => profileAndro };
    if (value.includes('QUEST HOLDINGS')) return { ok: true, text: async () => searchQuest };
    if (value.includes('ALPHA TRUST ANDROMEDA')) return { ok: true, text: async () => searchAndro };`, 'Athens profile fetch fixtures');
  source = replaceRequired(source, '  assert.equal(result.version, 6);', '  assert.equal(result.version, 7);', 'Athens discovery fixture version');
  source = replaceRequired(source, `  assert.equal(result.companies.find((item) => item.taxonomyTermId === '549').primaryListing.symbol, 'ANDRO');
  const unexpectedDiagnostics`, `  assert.equal(result.companies.find((item) => item.taxonomyTermId === '549').primaryListing.symbol, 'ANDRO');
  assert.equal(result.classificationSnapshotCount, 2);
  assert.equal(result.classificationSnapshots.length, 2);
  assert.equal(result.classificationSnapshots.find((item) => item.companyId === 'company:xath:term-340').taxonomy, 'FTSE_RUSSELL_ICB');
  assert.equal(result.classificationSnapshots.find((item) => item.companyId === 'company:xath:term-340').sector, 'Technology');
  assert.equal(result.classificationSnapshots.find((item) => item.companyId === 'company:xath:term-549').subSector, 'Closed End Investments');
  const unexpectedDiagnostics`, 'Athens classification fixture assertions');
  write(relativePath, source);
}

function patchManifestAssertions() {
  let source = read('test/v180-factor-production-observability-runtime.test.js');
  source = replaceRequired(source, `  assert.ok(manifest.testPatches.includes('apply-v1811-oos-instrument-concentration.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1811-oos-instrument-concentration.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1812-forecast-classification-lineage.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1812-forecast-classification-lineage.js');
  assert.equal(new Set(manifest.testPatches).size, 61);
  assert.equal(new Set(manifest.buildPatches).size, 60);`, `  assert.ok(manifest.testPatches.includes('apply-v1812-forecast-classification-lineage.js'));
  assert.ok(manifest.buildPatches.includes('apply-v1812-forecast-classification-lineage.js'));
  assert.equal(manifest.testPatches.at(-1), 'apply-v1813-athens-icb-classification-lineage.js');
  assert.equal(manifest.buildPatches.at(-1), 'apply-v1813-athens-icb-classification-lineage.js');
  assert.equal(new Set(manifest.testPatches).size, 62);
  assert.equal(new Set(manifest.buildPatches).size, 61);`, 'v1813 manifest assertions');
  write('test/v180-factor-production-observability-runtime.test.js', source);
}

patchAthensDiscovery();
patchAutonomousDiscovery();
patchAutonomousRunner();
patchDailyRunner();
patchAthensTestFixture();
patchManifestAssertions();
console.log('Investor Control v1.8.0 Athens canonical ICB classification lineage applied.');

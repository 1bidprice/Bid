import fs from 'node:fs';
import path from 'node:path';

const reportPath = path.resolve(process.argv[2] || 'out/autonomous-intelligence.json');
const feedPath = path.resolve(process.argv[3] || 'out/mobile-intelligence-feed.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));

const allowedActions = new Set(['BUY_NOW', 'SELL_NOW', 'HOLD', 'DO_NOT_BUY', 'AVOID', 'WATCH']);
const narrativeMetricPattern = /\b(amounted to|stood at|reached|was formed at|were formed at|compared (?:with|to)|versus|of which|representing|presenting|increased (?:to|by)|decreased (?:to|by)|rose (?:to|by)|fell (?:to|by))\b/i;
const dateTokenPattern = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/;

function fail(message) {
  throw new Error(`PRODUCTION_SAFETY_REJECTED: ${message}`);
}

function values(facts = []) {
  return facts.map((fact) => Number(fact?.value));
}

if (report.format !== 'investor-control-daily-intelligence' || report.version !== 8) fail('wrong report contract');
if (feed.format !== 'investor-control-mobile-intelligence-feed' || feed.version !== 2) fail('wrong feed contract');
if (report.discovery?.sourcePolicy?.selector !== 'DETERMINISTIC_SOURCE_GOVERNOR') fail('source governor missing');
if (report.discovery?.sourcePolicy?.runtimeAiSourceSelection !== false) fail('runtime AI source selection enabled');
if (!report.discovery?.marketsScanned?.includes('US') || !report.discovery?.marketsScanned?.includes('GR')) fail('US/GR discovery missing');

const generated = new Date(report.generatedAt).getTime();
if (!Number.isFinite(generated) || Math.abs(Date.now() - generated) > 3_600_000) fail('stale production output');

const greek = (report.discovery?.shortlist || []).filter((item) => item.market === 'GR');
const unresolvedGreek = greek.filter((item) => !item.symbol || item.identityStatus === 'SYMBOL_RESOLUTION_REQUIRED');
if (unresolvedGreek.length) fail(`unresolved Greek identities: ${unresolvedGreek.map((item) => item.companyName).join(', ')}`);

if (!feed.quoteRegistry || Array.isArray(feed.quoteRegistry)) fail('canonical quote registry missing');
for (const [symbol, quote] of Object.entries(feed.quoteRegistry)) {
  if (!quote?.quoteContract || quote.appSymbol !== symbol) fail(`invalid canonical quote: ${symbol}`);
  if (quote.quoteContract.sourceRole === 'FALLBACK_UNVERIFIED' && (quote.quoteContract.valuationEligible || quote.quoteContract.decisionEligible)) {
    fail(`unsafe fallback quote became eligible: ${symbol}`);
  }
}

const athensFacts = (snapshot) => [
  ...(snapshot?.annual?.revenue || []).map((fact) => ({ fact, expectedContext: 'INCOME_STATEMENT', metric: 'revenue' })),
  ...(snapshot?.annual?.netIncome || []).map((fact) => ({ fact, expectedContext: 'INCOME_STATEMENT', metric: 'netIncome' })),
  ...(snapshot?.annual?.operatingCashFlow || []).map((fact) => ({ fact, expectedContext: 'CASH_FLOW', metric: 'operatingCashFlow' })),
  ...(snapshot?.annual?.capitalExpenditure || []).map((fact) => ({ fact, expectedContext: 'CASH_FLOW', metric: 'capitalExpenditure' })),
  ...(snapshot?.annual?.dilutedShares || []).map((fact) => ({ fact, expectedContext: 'INCOME_STATEMENT', metric: 'dilutedShares' })),
  { fact: snapshot?.instant?.cash, expectedContext: 'BALANCE_SHEET', metric: 'cash' },
  { fact: snapshot?.instant?.assets, expectedContext: 'BALANCE_SHEET', metric: 'assets' },
  { fact: snapshot?.instant?.liabilities, expectedContext: 'BALANCE_SHEET', metric: 'liabilities' },
  { fact: snapshot?.instant?.equity, expectedContext: 'BALANCE_SHEET', metric: 'equity' },
].filter((entry) => entry.fact?.provenance?.sourceRole === 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT');

for (const snapshot of report.fundamentalSnapshots || []) {
  const model = snapshot?.model || null;
  if (model?.specializedModelRequired === true && model?.specializedModelImplemented !== true) {
    if (snapshot.metricsReady === true) fail(`specialized model falsely ready: ${snapshot.companyId}`);
    for (const value of [
      snapshot?.metrics?.annualRevenueGrowthPct,
      snapshot?.metrics?.annualNetMarginPct,
      snapshot?.metrics?.latestFreeCashFlow,
      snapshot?.metrics?.latestAnnualFreeCashFlowUSD,
    ]) {
      if (value !== null && value !== undefined) fail(`generic metric leaked from specialized model: ${snapshot.companyId}`);
    }
  }

  if (snapshot?.format === 'investor-control-euronext-athens-fundamentals') {
    const selection = snapshot?.sourceDocument?.candidateSelection || null;
    if (selection?.reviewedSelected !== true) fail(`Athens fundamentals bypassed reviewed candidate selection: ${snapshot.companyId}`);
    if (snapshot?.sourceDocument?.extractionStatus !== 'REVIEWED_PDF') fail(`Athens fundamentals selected unreviewed PDF: ${snapshot.companyId}:${snapshot?.sourceDocument?.extractionStatus || 'NONE'}`);
    if (!(Number(selection?.accountingCoverage) >= 3)) fail(`Athens fundamentals selected insufficient accounting content: ${snapshot.companyId}:${selection?.accountingCoverage}`);
  }

  const verifiedAthensFacts = athensFacts(snapshot);
  if (verifiedAthensFacts.length) {
    if (snapshot?.quality?.rowLabelPolicy !== 'ROW_LABEL_ANCHORED_V1') fail(`Athens snapshot missing row-label policy: ${snapshot.companyId}`);
    if (snapshot?.quality?.numericSemanticsPolicy !== 'FINANCIAL_TABLE_NUMBER_V1') fail(`Athens snapshot missing numeric-semantics policy: ${snapshot.companyId}`);
    const balanceStatus = snapshot?.quality?.balanceSheetIntegrity?.status || 'INSUFFICIENT_DATA';
    if (balanceStatus === 'FAILED') fail(`Athens balance-sheet integrity failed: ${snapshot.companyId}:${(snapshot.quality.balanceSheetIntegrity.issues || []).join(',')}`);
    if (snapshot.metricsReady === true && balanceStatus !== 'PASSED') fail(`Athens snapshot ready without passed balance sheet: ${snapshot.companyId}:${balanceStatus}`);
  }

  for (const { fact, expectedContext, metric } of verifiedAthensFacts) {
    const provenance = fact.provenance || {};
    const line = String(provenance.extractedLine || '');
    if (provenance.metricExtractionPolicy !== 'STATEMENT_ROW_ONLY_V2') fail(`Athens metric missing statement-row policy: ${snapshot.companyId}:${metric}`);
    if (provenance.selectionPolicy !== 'ACCOUNTING_STATEMENT_CONTEXT_V1') fail(`Athens metric missing accounting-context policy: ${snapshot.companyId}:${metric}`);
    if (!Array.isArray(provenance.statementContexts) || !provenance.statementContexts.includes(expectedContext)) fail(`Athens metric wrong accounting context: ${snapshot.companyId}:${metric}:${expectedContext}`);
    if (!(Number(provenance.contextScore) > 0)) fail(`Athens metric missing context score: ${snapshot.companyId}:${metric}`);
    if (!(Number(provenance.statementAuthorityScore) > 0)) fail(`Athens metric missing statement authority: ${snapshot.companyId}:${metric}`);
    if (!Array.isArray(provenance.candidateAudit)) fail(`Athens metric missing candidate audit: ${snapshot.companyId}:${metric}`);
    if (narrativeMetricPattern.test(line)) fail(`narrative Athens metric leaked: ${snapshot.companyId}:${metric}`);
    if (dateTokenPattern.test(line) && !/statement|total|revenue|sales|profit|income|cash|assets|liabilities|equity/i.test(line)) fail(`date-contaminated Athens metric leaked: ${snapshot.companyId}:${metric}`);
  }

  if (snapshot.companyId === 'company:xath:term-490' && snapshot?.reporting?.periodEnd === '2025-06-30') {
    const revenue = values(snapshot?.annual?.revenue);
    const netIncome = values(snapshot?.annual?.netIncome);
    if (revenue[0] !== 49_558_000 || revenue[1] !== 192_673_000) fail(`ELLAKTOR H1 revenue regression: ${JSON.stringify(revenue)}`);
    if (netIncome[0] !== -29_934_000 || netIncome[1] !== 46_831_000) fail(`ELLAKTOR H1 net-income regression: ${JSON.stringify(netIncome)}`);
    for (const fact of [...(snapshot?.annual?.revenue || []), ...(snapshot?.annual?.netIncome || [])]) {
      if (fact?.provenance?.pageNumber !== 53) fail(`ELLAKTOR Group metric selected from wrong page: ${fact?.provenance?.pageNumber}`);
      if (fact?.provenance?.statementColumnPolicy !== 'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1') fail('ELLAKTOR Group metric lost multi-column policy');
    }
    if ((snapshot?.annual?.dilutedShares || []).length !== 0) fail('ELLAKTOR complex EPS produced synthetic diluted shares');
    const balance = snapshot?.quality?.balanceSheetIntegrity;
    if (balance?.status !== 'PASSED' || Number(balance?.balanceEquationDifferencePct) !== 0) fail('ELLAKTOR balance sheet no longer reconciles exactly');
  }
}

for (const candidate of feed.discoveryRadar || []) {
  if (candidate.suggestedAction !== 'WATCH' || candidate.investmentScore !== null) fail('discovery leaked recommendation');
}

for (const record of report.structuredDecisionEvidence || []) {
  if (record?.eventClaimEligible !== false) fail(`structured decision evidence became event-claim eligible: ${record?.id}`);
  if (record?.document?.status !== 'VERIFIED_STRUCTURED_DATA' || record?.document?.reviewed !== true) fail(`unreviewed structured decision evidence: ${record?.id}`);
}

for (const dossier of report.researchDossiers || []) {
  const action = dossier.finalAction;
  if (!action || !allowedActions.has(action.marketAction)) fail(`invalid final action: ${dossier.companyId}`);
  if (action.execution?.automaticBrokerOrder !== false || action.execution?.requiresUserExecution !== true) fail(`broker boundary broken: ${dossier.companyId}`);
  if (action.status === 'BLOCKED' && action.marketAction !== 'WATCH') fail(`blocked action leaked direction: ${dossier.companyId}`);

  const baseline = dossier.decisionBasis === 'FUNDAMENTAL_BASELINE';
  const decisionReady = dossier?.metrics?.decisionCorroboration?.ready === true;
  if (baseline && dossier?.readiness?.publishable === true) {
    if (!decisionReady) fail(`publishable baseline dossier lost decision corroboration: ${dossier.companyId}`);
    if (action?.blockers?.includes('CROSS_CHECK_NOT_READY')) fail(`baseline dossier falsely blocked by event cross-check: ${dossier.companyId}`);
  }
  if (dossier.decisionBasis === 'EVENT_DRIVEN' && action.status === 'FINAL' && dossier?.metrics?.crossCheck?.recommendationReady !== true) {
    fail(`event-driven final action escaped claim corroboration: ${dossier.companyId}`);
  }

  const risk = dossier?.metrics?.fundamentalRisk || null;
  if (risk?.currencyConsistent === false) fail(`fundamental currency mismatch: ${dossier.companyId}`);
  if (risk?.model?.specializedModelRequired === true) {
    if (risk.riskScore !== null) fail(`generic risk score leaked from specialized model: ${dossier.companyId}`);
    if (risk?.valuation?.priceToSales !== null || risk?.valuation?.priceToBook !== null || risk?.profitability?.netMarginPct !== null) fail(`generic valuation leaked from specialized model: ${dossier.companyId}`);
  }
  if (risk?.specializedAnalysis?.type === 'BANK' && risk.specializedAnalysis.decisionReady !== true && risk.metricsReady === true) fail(`incomplete bank passport marked fundamentals ready: ${dossier.companyId}`);
}

console.log(JSON.stringify({
  status: 'VERIFIED',
  generatedAt: report.generatedAt,
  greekCandidates: greek.length,
  unresolvedGreek: unresolvedGreek.length,
  marketSnapshots: report.marketSnapshotCount,
  historicalMetrics: report.historicalMarketMetricsCount,
  fundamentals: report.fundamentalSnapshotCount,
  finalActions: feed.summary?.finalActionCount,
  blocked: feed.summary?.blockedDecisionCount,
  baselineDecisionSerialization: 'REQUIRED',
  eventClaimSeparation: 'REQUIRED',
  euronextReviewedCandidateSelection: 'REQUIRED',
  ellaktorH1ConsolidatedRegression: 'VERIFIED',
  athensStatementAuthority: 'REQUIRED',
  athensCandidateAudit: 'REQUIRED'
}, null, 2));

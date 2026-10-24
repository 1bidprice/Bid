export const OPERATIONAL_HEALTH_POLICY_VERSION = '2026-09-12.1';

const MARKET_COVERAGE_OPERATIONAL_MIN = 0.9;
const HISTORY_COVERAGE_OPERATIONAL_MIN = 0.9;
const FUNDAMENTAL_COVERAGE_OPERATIONAL_MIN = 0.8;

function finiteCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function coverage(numerator, denominator) {
  const safeDenominator = Math.max(1, finiteCount(denominator));
  return finiteCount(numerator) / safeDenominator;
}

function rounded(value) {
  return Number(Number(value || 0).toFixed(4));
}

export function buildOperationalHealth(input = {}) {
  const analysedCompanyCount = Math.max(1, finiteCount(input.analysedCompanyCount));
  const marketSnapshotCount = finiteCount(input.marketSnapshotCount);
  const historicalMarketMetricsCount = finiteCount(input.historicalMarketMetricsCount);
  const readyHistoricalMarketMetricsCount = finiteCount(input.readyHistoricalMarketMetricsCount);
  const fundamentalSnapshotCount = finiteCount(input.fundamentalSnapshotCount);
  const finalActionCount = finiteCount(input.finalActionCount);
  const blockedDecisionCount = finiteCount(input.blockedDecisionCount);
  const researchDossierCount = finiteCount(input.researchDossierCount);
  const unresolvedDiagnosticCount = finiteCount(input.unresolvedDiagnosticCount);

  const marketCoverageRatio = coverage(marketSnapshotCount, analysedCompanyCount);
  const historyCoverageRatio = coverage(readyHistoricalMarketMetricsCount, analysedCompanyCount);
  const fundamentalCoverageRatio = coverage(fundamentalSnapshotCount, analysedCompanyCount);

  const marketDataStatus = marketCoverageRatio >= MARKET_COVERAGE_OPERATIONAL_MIN
    ? 'OPERATIONAL'
    : 'DEGRADED';
  const historicalAnalyticsStatus = historyCoverageRatio >= HISTORY_COVERAGE_OPERATIONAL_MIN
    ? 'OPERATIONAL'
    : readyHistoricalMarketMetricsCount > 0
      ? 'PARTIAL'
      : 'UNAVAILABLE';
  const fundamentalsStatus = fundamentalCoverageRatio >= FUNDAMENTAL_COVERAGE_OPERATIONAL_MIN
    ? 'OPERATIONAL'
    : 'DEGRADED';
  const decisionEngineStatus = finalActionCount > 0
    ? 'READY'
    : blockedDecisionCount > 0
      ? 'BLOCKED_BY_EVIDENCE'
      : 'IDLE';

  // Historical analytics coverage is deliberately reported separately. Missing
  // history may block an individual dossier, but it is not a current quote-feed
  // outage and must not make the whole production system look broken.
  const status = marketDataStatus === 'OPERATIONAL' && fundamentalsStatus === 'OPERATIONAL'
    ? 'OPERATIONAL'
    : 'DEGRADED';

  return {
    policyVersion: OPERATIONAL_HEALTH_POLICY_VERSION,
    status,
    infrastructureStatus: 'OPERATIONAL',
    marketDataStatus,
    historicalAnalyticsStatus,
    fundamentalsStatus,
    researchStatus: researchDossierCount > 0 ? 'ACTIVE' : 'IDLE',
    decisionEngineStatus,
    generatedAt: input.generatedAt || null,
    analysedCompanyCount,
    marketSnapshotCount,
    marketCoverageRatio: rounded(marketCoverageRatio),
    historicalMarketMetricsCount,
    readyHistoricalMarketMetricsCount,
    historyCoverageRatio: rounded(historyCoverageRatio),
    fundamentalSnapshotCount,
    fundamentalCoverageRatio: rounded(fundamentalCoverageRatio),
    unresolvedDiagnosticCount,
    finalActionCount,
    blockedDecisionCount,
    staleOutput: false,
  };
}

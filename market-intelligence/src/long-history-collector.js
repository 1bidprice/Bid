import { fetchLongHistoryResearchSeries } from './long-history-research.js';

export const LONG_HISTORY_COLLECTOR_VERSION = '2026-08-11.1';

function isAthensListing(company = {}) {
  const listing = company.primaryListing || company.listing || {};
  return String(listing.mic || '').toUpperCase() === 'XATH' || /Athens/i.test(String(listing.exchange || ''));
}

function yahooSymbols(company = {}) {
  const configured = Array.isArray(company?.marketData?.yahooSymbols)
    ? company.marketData.yahooSymbols.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (configured.length) return [...new Set(configured)];
  const listing = company.primaryListing || company.listing || {};
  const symbol = String(listing.symbol || '').trim();
  if (!symbol) return [];
  return isAthensListing(company) ? [`${symbol}.AT`] : [symbol];
}

function dossierPriority(dossier = {}) {
  if (dossier?.finalAction?.status === 'FINAL') return 0;
  if (dossier?.metrics?.crossCheck?.recommendationReady === true || dossier?.readiness?.publishable === true) return 1;
  return 2;
}

function uniquePrioritizedDossiers(items = []) {
  const sorted = (Array.isArray(items) ? items : [])
    .filter((item) => item?.companyId)
    .slice()
    .sort((a, b) => dossierPriority(a) - dossierPriority(b) || String(a.companyId).localeCompare(String(b.companyId)));
  const seen = new Set();
  return sorted.filter((item) => {
    if (seen.has(item.companyId)) return false;
    seen.add(item.companyId);
    return true;
  });
}

function canonicalObservationCount(series) {
  return Array.isArray(series?.candles) ? series.candles.length : 0;
}

function canonicalIsYahoo(series = {}) {
  const source = String(series.source || '').toLowerCase();
  let host = '';
  try { host = new URL(String(series.sourceUrl || '')).hostname.toLowerCase(); } catch {}
  return source.includes('yahoo') || host.includes('finance.yahoo.com');
}

function rejectedRecord(companyId, blockers, details = {}) {
  return {
    format: 'investor-control-long-history-research-series',
    version: 1,
    policyVersion: LONG_HISTORY_COLLECTOR_VERSION,
    companyId,
    status: 'REJECTED',
    researchEligible: false,
    decisionEligible: false,
    executionEligible: false,
    observationCount: 0,
    crossCheck: null,
    blockers: [...new Set(blockers)],
    diagnostics: details.diagnostics || [],
    series: null,
    ...details,
  };
}

export async function collectLongHistoryResearch(input = {}) {
  const options = input.options || {};
  const collector = new Map();
  const enabled = options.enableLongHistoryResearch !== false;
  const dossiers = uniquePrioritizedDossiers(input.researchDossiers);
  const universe = Array.isArray(input.universe) ? input.universe : [];
  const universeByCompany = new Map(universe.filter((item) => item?.companyId).map((item) => [item.companyId, item]));
  const canonicalCollector = input.historicalSeriesCollector instanceof Map ? input.historicalSeriesCollector : new Map();
  const limit = Math.min(50, Math.max(1, Number(options.longHistoryResearchLimit || 8)));
  const minimumOverlapSessions = Math.max(10, Number(options.longHistoryMinimumOverlapSessions || 40));
  const minimumObservations = Math.max(260, Number(options.minimumLongHistoryObservations || 1260));
  const fetcher = options.longHistoryFetcher || fetchLongHistoryResearchSeries;
  const selected = enabled ? dossiers.slice(0, limit) : [];
  const summary = {
    format: 'investor-control-long-history-collection-summary',
    version: 1,
    policyVersion: LONG_HISTORY_COLLECTOR_VERSION,
    enabled,
    eligibleDossierCount: dossiers.length,
    selectedCount: selected.length,
    attemptedCount: 0,
    readyCount: 0,
    rejectedCount: 0,
    skippedNoCanonicalCount: 0,
    skippedNonIndependentCount: 0,
    skippedByLimit: enabled ? Math.max(0, dossiers.length - selected.length) : 0,
    minimumOverlapSessions,
    minimumObservations,
  };

  if (!enabled) return { collector, summary };

  for (const dossier of selected) {
    const company = universeByCompany.get(dossier.companyId) || {
      companyId: dossier.companyId,
      displayName: dossier.companyName,
      primaryListing: dossier.listing,
    };
    const canonicalSeries = canonicalCollector.get(dossier.companyId) || null;
    const overlapCount = canonicalObservationCount(canonicalSeries);
    if (!canonicalSeries?.usable || overlapCount < minimumOverlapSessions) {
      const blockers = !canonicalSeries?.usable
        ? ['CANONICAL_OVERLAP_SERIES_REQUIRED']
        : ['LONG_HISTORY_CANONICAL_OVERLAP_TOO_SMALL'];
      collector.set(dossier.companyId, rejectedRecord(dossier.companyId, blockers, {
        canonicalObservationCount: overlapCount,
      }));
      summary.rejectedCount += 1;
      summary.skippedNoCanonicalCount += 1;
      continue;
    }

    // The built-in long-history provider is Yahoo. If the canonical overlap is
    // already Yahoo, do not spend a max-range request merely to fail the
    // independence gate later. Injected alternative fetchers are not assumed
    // to share that source and still receive the canonical series for validation.
    if (fetcher === fetchLongHistoryResearchSeries && canonicalIsYahoo(canonicalSeries)) {
      collector.set(dossier.companyId, rejectedRecord(dossier.companyId, ['INDEPENDENT_CANONICAL_OVERLAP_SOURCE_REQUIRED'], {
        canonicalObservationCount: overlapCount,
      }));
      summary.rejectedCount += 1;
      summary.skippedNonIndependentCount += 1;
      continue;
    }

    const symbols = yahooSymbols(company);
    if (!symbols.length) {
      collector.set(dossier.companyId, rejectedRecord(dossier.companyId, ['LONG_HISTORY_PROVIDER_SYMBOL_MISSING'], {
        canonicalObservationCount: overlapCount,
      }));
      summary.rejectedCount += 1;
      continue;
    }

    summary.attemptedCount += 1;
    try {
      const record = await fetcher(symbols[0], {
        ...options,
        symbol: company.primaryListing?.symbol || dossier.listing?.symbol || symbols[0],
        alternateSymbols: symbols.slice(1),
        currency: company.currency || company.primaryListing?.currency || dossier.listing?.currency || null,
        canonicalSeries,
        range: 'max',
        interval: '1d',
        minimumObservations,
        crossCheckOptions: {
          ...(options.longHistoryCrossCheckOptions || {}),
          minimumOverlapSessions,
        },
      });
      const normalized = {
        ...record,
        companyId: dossier.companyId,
        collectorPolicyVersion: LONG_HISTORY_COLLECTOR_VERSION,
      };
      collector.set(dossier.companyId, normalized);
      if (normalized.status === 'RESEARCH_READY' && normalized.researchEligible === true) summary.readyCount += 1;
      else summary.rejectedCount += 1;
    } catch (error) {
      collector.set(dossier.companyId, rejectedRecord(dossier.companyId, ['LONG_HISTORY_PROVIDER_FAILED'], {
        canonicalObservationCount: overlapCount,
        diagnostics: [{ code: 'LONG_HISTORY_PROVIDER_FAILED', message: error instanceof Error ? error.message : String(error) }],
      }));
      summary.rejectedCount += 1;
    }
  }

  return { collector, summary };
}

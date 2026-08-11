import { crossCheckLongHistorySeries, fetchLongHistoryResearchSeries } from './long-history-research.js';
import { fetchTwelveDataTimeSeries } from './adapters/twelve-data-time-series.js';

export const LONG_HISTORY_COLLECTOR_VERSION = '2026-08-11.2';

const US_MICS = new Set(['XNAS', 'XNYS', 'ARCX', 'XASE']);

function isAthensListing(company = {}) {
  const listing = company.primaryListing || company.listing || {};
  return String(listing.mic || '').toUpperCase() === 'XATH' || /Athens/i.test(String(listing.exchange || ''));
}

function isUsListing(company = {}) {
  const listing = company.primaryListing || company.listing || {};
  const mic = String(listing.mic || '').toUpperCase();
  return String(company.country || '').toUpperCase() === 'US' || US_MICS.has(mic) || /Nasdaq|NYSE|New York Stock Exchange|NYSE Arca|NYSE American/i.test(String(listing.exchange || ''));
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

function witnessOutputsize(options, minimumOverlapSessions) {
  const configured = Number(options.independentOverlapOutputsize || 160);
  return Math.min(5000, Math.max(minimumOverlapSessions + 20, 80, Number.isFinite(configured) ? Math.floor(configured) : 160));
}

async function resolveIndependentOverlapSeries({ company, canonicalSeries, minimumOverlapSessions, options, summary, requiresYahooWitness }) {
  if (!requiresYahooWitness || !canonicalIsYahoo(canonicalSeries)) {
    return { series: canonicalSeries, diagnostics: [], witnessCrossCheck: null, blocker: null };
  }

  if (!isUsListing(company)) {
    summary.independentOverlapRejectedCount += 1;
    return {
      series: null,
      diagnostics: [{ code: 'INDEPENDENT_OVERLAP_US_ONLY', companyId: company.companyId }],
      witnessCrossCheck: null,
      blocker: 'INDEPENDENT_CANONICAL_OVERLAP_SOURCE_REQUIRED',
    };
  }

  const apiKey = String(options.twelveDataApiKey || process.env.TWELVE_DATA_API_KEY || '').trim();
  if (!apiKey) {
    summary.independentOverlapRejectedCount += 1;
    return {
      series: null,
      diagnostics: [{ code: 'TWELVE_DATA_API_KEY_MISSING', companyId: company.companyId }],
      witnessCrossCheck: null,
      blocker: 'INDEPENDENT_CANONICAL_OVERLAP_SOURCE_REQUIRED',
    };
  }

  const listing = company.primaryListing || company.listing || {};
  const symbol = String(listing.symbol || '').trim();
  if (!symbol) {
    summary.independentOverlapRejectedCount += 1;
    return {
      series: null,
      diagnostics: [{ code: 'INDEPENDENT_OVERLAP_SYMBOL_MISSING', companyId: company.companyId }],
      witnessCrossCheck: null,
      blocker: 'INDEPENDENT_CANONICAL_OVERLAP_SOURCE_REQUIRED',
    };
  }

  const overlapFetcher = options.independentOverlapFetcher || fetchTwelveDataTimeSeries;
  summary.independentOverlapAttemptedCount += 1;
  const result = await overlapFetcher(symbol, {
    apiKey,
    symbol,
    currency: company.currency || listing.currency || null,
    micCode: String(listing.mic || '').trim() || null,
    interval: '1day',
    outputsize: witnessOutputsize(options, minimumOverlapSessions),
    generatedAt: options.generatedAt,
    fetchImpl: options.fetchImpl,
    userAgent: options.userAgent,
  });
  const witnessSeries = result?.series || null;
  const witnessCount = canonicalObservationCount(witnessSeries);
  if (!witnessSeries?.usable || witnessCount < minimumOverlapSessions) {
    summary.independentOverlapRejectedCount += 1;
    return {
      series: null,
      diagnostics: [
        ...(result?.diagnostics || []),
        { code: witnessSeries?.usable ? 'INDEPENDENT_OVERLAP_TOO_SMALL' : 'INDEPENDENT_OVERLAP_PROVIDER_UNAVAILABLE', companyId: company.companyId, observationCount: witnessCount },
      ],
      witnessCrossCheck: null,
      blocker: 'INDEPENDENT_CANONICAL_OVERLAP_SOURCE_REQUIRED',
    };
  }

  const witnessCrossCheck = crossCheckLongHistorySeries(canonicalSeries, witnessSeries, {
    ...(options.longHistoryCrossCheckOptions || {}),
    minimumOverlapSessions,
  });
  if (!witnessCrossCheck.researchEligible) {
    summary.independentOverlapRejectedCount += 1;
    return {
      series: null,
      diagnostics: [
        ...(result?.diagnostics || []),
        { code: 'INDEPENDENT_OVERLAP_CROSSCHECK_FAILED', companyId: company.companyId, blockers: witnessCrossCheck.blockers },
      ],
      witnessCrossCheck,
      blocker: 'INDEPENDENT_CANONICAL_OVERLAP_SOURCE_REQUIRED',
    };
  }

  summary.independentOverlapReadyCount += 1;
  return {
    series: witnessSeries,
    diagnostics: [
      ...(result?.diagnostics || []),
      { code: 'INDEPENDENT_OVERLAP_WITNESS_VALIDATED', companyId: company.companyId, provider: witnessSeries.source || 'Twelve Data Time Series' },
    ],
    witnessCrossCheck,
    blocker: null,
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
  const requiresYahooWitness = options.longHistoryNeedsIndependentYahooWitness !== undefined
    ? options.longHistoryNeedsIndependentYahooWitness === true
    : fetcher === fetchLongHistoryResearchSeries;
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
    independentOverlapAttemptedCount: 0,
    independentOverlapReadyCount: 0,
    independentOverlapRejectedCount: 0,
    independentOverlapProvider: 'Twelve Data Time Series',
    skippedByLimit: enabled ? Math.max(0, dossiers.length - selected.length) : 0,
    minimumOverlapSessions,
    minimumObservations,
  };

  if (!enabled) return { collector, summary };

  for (const dossier of selected) {
    const company = universeByCompany.get(dossier.companyId) || {
      companyId: dossier.companyId,
      displayName: dossier.companyName,
      country: dossier.country || null,
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

    let overlapResolution;
    try {
      overlapResolution = await resolveIndependentOverlapSeries({
        company,
        canonicalSeries,
        minimumOverlapSessions,
        options,
        summary,
        requiresYahooWitness,
      });
    } catch (error) {
      summary.independentOverlapRejectedCount += 1;
      overlapResolution = {
        series: null,
        diagnostics: [{ code: 'INDEPENDENT_OVERLAP_PROVIDER_FAILED', companyId: dossier.companyId, message: error instanceof Error ? error.message : String(error) }],
        witnessCrossCheck: null,
        blocker: 'INDEPENDENT_CANONICAL_OVERLAP_SOURCE_REQUIRED',
      };
    }

    if (!overlapResolution.series) {
      collector.set(dossier.companyId, rejectedRecord(dossier.companyId, [overlapResolution.blocker || 'INDEPENDENT_CANONICAL_OVERLAP_SOURCE_REQUIRED'], {
        canonicalObservationCount: overlapCount,
        independentOverlapCrossCheck: overlapResolution.witnessCrossCheck,
        diagnostics: overlapResolution.diagnostics,
      }));
      summary.rejectedCount += 1;
      summary.skippedNonIndependentCount += 1;
      continue;
    }

    const symbols = yahooSymbols(company);
    if (!symbols.length) {
      collector.set(dossier.companyId, rejectedRecord(dossier.companyId, ['LONG_HISTORY_PROVIDER_SYMBOL_MISSING'], {
        canonicalObservationCount: overlapCount,
        diagnostics: overlapResolution.diagnostics,
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
        canonicalSeries: overlapResolution.series,
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
        independentOverlapSource: overlapResolution.series === canonicalSeries ? null : overlapResolution.series.source || null,
        independentOverlapCrossCheck: overlapResolution.witnessCrossCheck,
        diagnostics: [...(overlapResolution.diagnostics || []), ...(record?.diagnostics || [])],
      };
      collector.set(dossier.companyId, normalized);
      if (normalized.status === 'RESEARCH_READY' && normalized.researchEligible === true) summary.readyCount += 1;
      else summary.rejectedCount += 1;
    } catch (error) {
      collector.set(dossier.companyId, rejectedRecord(dossier.companyId, ['LONG_HISTORY_PROVIDER_FAILED'], {
        canonicalObservationCount: overlapCount,
        independentOverlapCrossCheck: overlapResolution.witnessCrossCheck,
        diagnostics: [
          ...(overlapResolution.diagnostics || []),
          { code: 'LONG_HISTORY_PROVIDER_FAILED', message: error instanceof Error ? error.message : String(error) },
        ],
      }));
      summary.rejectedCount += 1;
    }
  }

  return { collector, summary };
}

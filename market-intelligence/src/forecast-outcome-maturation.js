import { fetchProfessionalMarketSnapshot, fetchProfessionalHistoricalMetrics } from './professional-market-data.js';

export const FORECAST_OUTCOME_MATURATION_VERSION = '2026-08-11.1';

function dueAt(record) {
  const reference = new Date(record?.referencePrice?.timestamp || record?.forecastAt || 0).getTime();
  const tradingDays = Math.max(1, Number(record?.tradingDays || 0));
  if (!Number.isFinite(reference) || reference <= 0 || tradingDays <= 0) return null;
  // A trading-day outcome can never become observable before this lower-bound
  // calendar date. Weekends/holidays may delay it further, in which case the
  // normal ledger evaluator simply leaves the record OPEN.
  return reference + tradingDays * 86_400_000;
}

function isDue(record, generatedAt) {
  if (record?.status !== 'OPEN' || record?.validationMode !== 'LIVE_SHADOW_OOS') return false;
  const due = dueAt(record);
  const now = new Date(generatedAt || Date.now()).getTime();
  return due !== null && Number.isFinite(now) && now >= due;
}

function inferCountry(record = {}) {
  if (record.country) return record.country;
  const mic = String(record?.listing?.mic || record?.mic || '').toUpperCase();
  const exchange = String(record?.listing?.exchange || record?.exchange || '');
  if (String(record.companyId || '').startsWith('sec-cik:')) return 'US';
  if (mic === 'XATH' || /Athens/i.test(exchange)) return 'GR';
  if (['XNAS', 'XNYS', 'ARCX', 'XASE'].includes(mic) || /Nasdaq|New York Stock Exchange|NYSE/i.test(exchange)) return 'US';
  return null;
}

function archivedCompany(record, universeByCompany) {
  const current = universeByCompany.get(record.companyId) || null;
  if (current) return current;
  const symbol = String(record?.listing?.symbol || record?.symbol || '').trim();
  const country = inferCountry(record);
  if (!record?.companyId || !symbol || !country) return null;
  return {
    companyId: record.companyId,
    legalName: record.displayName || record.companyId,
    displayName: record.displayName || record.companyId,
    country,
    active: true,
    primaryListing: {
      symbol,
      mic: record?.listing?.mic || record?.mic || (country === 'GR' ? 'XATH' : null),
      exchange: record?.listing?.exchange || record?.exchange || null,
      currency: record?.listing?.currency || record?.referencePrice?.currency || (country === 'US' ? 'USD' : null),
    },
  };
}

function validatedOutcomeSeries(result) {
  const series = result?.series || null;
  if (!series?.usable || !Array.isArray(series?.candles) || !series.candles.length) return false;
  if (series.sourceQuality === 'PRIMARY_LICENSED') return true;
  return (result?.diagnostics || []).some((item) => item?.code === 'VALIDATED_HISTORY_FALLBACK_ACTIVE' && item?.crossCheckReady === true);
}

async function defaultOutcomeHistoryFetcher(company, options = {}) {
  const token = options.token || options.finnhubToken || process.env.FINNHUB_TOKEN || '';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const snapshotResult = await fetchProfessionalMarketSnapshot(company, {
    ...options,
    fetchImpl,
    token,
    generatedAt: options.generatedAt,
  });
  const snapshot = snapshotResult?.snapshot || null;
  if (!snapshot?.usable) {
    return {
      series: null,
      diagnostics: [...(snapshotResult?.diagnostics || []), { code: 'OUTCOME_MATURATION_SNAPSHOT_UNAVAILABLE', companyId: company.companyId }],
    };
  }
  const historyResult = await fetchProfessionalHistoricalMetrics(company, {
    ...options,
    fetchImpl,
    token,
    generatedAt: options.generatedAt,
    marketSnapshot: snapshot,
    benchmarkCache: options.benchmarkCache || new Map(),
    range: options.outcomeMaturationHistoryRange || '2y',
  });
  return {
    ...historyResult,
    diagnostics: [...(snapshotResult?.diagnostics || []), ...(historyResult?.diagnostics || [])],
  };
}

export async function collectDueForecastOutcomeHistory(input = {}) {
  const generatedAt = new Date(input.generatedAt || Date.now()).toISOString();
  const records = Array.isArray(input.existingRecords) ? input.existingRecords : [];
  const universe = Array.isArray(input.universe) ? input.universe : [];
  const historicalSeriesCollector = input.historicalSeriesCollector instanceof Map ? input.historicalSeriesCollector : new Map();
  const universeByCompany = new Map(universe.filter((item) => item?.companyId).map((item) => [item.companyId, item]));
  const fetcher = input.options?.outcomeMaturationHistoryFetcher || defaultOutcomeHistoryFetcher;
  const limit = Math.min(50, Math.max(1, Number(input.options?.outcomeMaturationCompanyLimit || 20)));
  const dueRecords = records.filter((record) => isDue(record, generatedAt));
  const dueByCompany = new Map();
  for (const record of dueRecords) {
    const group = dueByCompany.get(record.companyId) || [];
    group.push(record);
    dueByCompany.set(record.companyId, group);
  }

  const collector = new Map();
  const diagnostics = [];
  const candidates = [...dueByCompany.entries()]
    .filter(([companyId]) => !historicalSeriesCollector.get(companyId)?.usable)
    .sort((a, b) => {
      const aDue = Math.min(...a[1].map((item) => dueAt(item) || Number.MAX_SAFE_INTEGER));
      const bDue = Math.min(...b[1].map((item) => dueAt(item) || Number.MAX_SAFE_INTEGER));
      return aDue - bDue || String(a[0]).localeCompare(String(b[0]));
    });
  const selected = candidates.slice(0, limit);
  let fetchedCount = 0;
  let readyCount = 0;
  let rejectedCount = 0;
  let unresolvedIdentityCount = 0;

  for (const [companyId, companyRecords] of selected) {
    const company = archivedCompany(companyRecords[0], universeByCompany);
    if (!company) {
      unresolvedIdentityCount += 1;
      rejectedCount += 1;
      diagnostics.push({ code: 'OUTCOME_MATURATION_IDENTITY_UNRESOLVED', companyId });
      continue;
    }
    fetchedCount += 1;
    try {
      const result = await fetcher(company, {
        ...(input.options || {}),
        generatedAt,
      });
      if (validatedOutcomeSeries(result)) {
        collector.set(companyId, result.series);
        readyCount += 1;
      } else {
        rejectedCount += 1;
        diagnostics.push({
          code: 'OUTCOME_MATURATION_HISTORY_NOT_VALIDATED',
          companyId,
          source: result?.series?.source || null,
          sourceQuality: result?.series?.sourceQuality || null,
          diagnostics: result?.diagnostics || [],
        });
      }
    } catch (error) {
      rejectedCount += 1;
      diagnostics.push({
        code: 'OUTCOME_MATURATION_HISTORY_FAILED',
        companyId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    collector,
    summary: {
      format: 'investor-control-forecast-outcome-maturation-summary',
      version: 1,
      policyVersion: FORECAST_OUTCOME_MATURATION_VERSION,
      generatedAt,
      openRecordCount: records.filter((record) => record?.status === 'OPEN').length,
      dueRecordCount: dueRecords.length,
      dueCompanyCount: dueByCompany.size,
      alreadyCoveredCompanyCount: [...dueByCompany.keys()].filter((companyId) => historicalSeriesCollector.get(companyId)?.usable).length,
      selectedMissingCompanyCount: selected.length,
      fetchedCount,
      readyCount,
      rejectedCount,
      unresolvedIdentityCount,
      skippedByLimit: Math.max(0, candidates.length - selected.length),
      finalActionImpact: 'NONE',
    },
    diagnostics,
  };
}

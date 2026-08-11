import { buildInstrumentProfile } from './instrument-profile.js';
import { buildHistoricalPatternForecast } from './historical-pattern-engine.js';
import { synthesizeForecastDrivers } from './forecast-driver-synthesis.js';
import { buildProbabilisticForecastContract } from './probabilistic-forecast-contract.js';

export const SHADOW_FORECAST_ENGINE_VERSION = '2026-08-11.2';

function byId(items = [], key = 'companyId') {
  return new Map((Array.isArray(items) ? items : []).filter((item) => item?.[key]).map((item) => [item[key], item]));
}

function opportunityByInstrument(opportunityUniverse = {}) {
  const items = opportunityUniverse?.ranking?.items || [];
  return new Map(items.filter((item) => item?.instrumentId).map((item) => [item.instrumentId, item]));
}

function longHistoryDiagnostic(series, minimum = 520) {
  const observations = Array.isArray(series?.candles) ? series.candles.length : 0;
  return observations >= minimum ? null : {
    code: 'LONG_HISTORY_REQUIRED_FOR_PATTERN_LEARNING',
    observationCount: observations,
    minimumRecommendedObservations: minimum,
    message: 'Current market history is sufficient for basic market metrics only when short; multi-year history is required for reliable historical-pattern learning and OOS calibration.',
  };
}

function validLongHistoryRecord(record) {
  return record?.status === 'RESEARCH_READY' &&
    record?.researchEligible === true &&
    record?.decisionEligible === false &&
    record?.executionEligible === false &&
    record?.series?.usable === true &&
    Array.isArray(record?.series?.candles) &&
    record.series.candles.length > 0;
}

function selectPatternSeries(companyId, canonicalSeries, longHistoryCollector) {
  const longHistoryRecord = longHistoryCollector instanceof Map ? longHistoryCollector.get(companyId) || null : null;
  if (validLongHistoryRecord(longHistoryRecord)) {
    return {
      series: longHistoryRecord.series,
      source: {
        type: 'VALIDATED_LONG_HISTORY_RESEARCH',
        researchOnly: true,
        status: longHistoryRecord.status,
        policyVersion: longHistoryRecord.policyVersion || null,
        source: longHistoryRecord.source || longHistoryRecord.series?.source || null,
        providerSymbol: longHistoryRecord.providerSymbol || longHistoryRecord.series?.providerSymbol || null,
        observationCount: longHistoryRecord.observationCount || longHistoryRecord.series.candles.length,
        crossCheck: longHistoryRecord.crossCheck ? {
          status: longHistoryRecord.crossCheck.status || null,
          overlapSessions: longHistoryRecord.crossCheck.overlapSessions ?? null,
          medianReturnErrorBps: longHistoryRecord.crossCheck.medianReturnErrorBps ?? null,
          p95ReturnErrorBps: longHistoryRecord.crossCheck.p95ReturnErrorBps ?? null,
        } : null,
      },
      diagnostics: [],
    };
  }

  const canonicalObservationCount = Array.isArray(canonicalSeries?.candles) ? canonicalSeries.candles.length : 0;
  const diagnostics = [];
  if (longHistoryRecord && longHistoryRecord.status !== 'RESEARCH_READY') {
    diagnostics.push({
      code: 'LONG_HISTORY_RESEARCH_REJECTED',
      status: longHistoryRecord.status || null,
      blockers: Array.isArray(longHistoryRecord.blockers) ? longHistoryRecord.blockers : [],
      message: 'Long-history research data did not pass validation and was not used for pattern learning.',
    });
  } else if (longHistoryRecord && !validLongHistoryRecord(longHistoryRecord)) {
    diagnostics.push({
      code: 'LONG_HISTORY_RESEARCH_CONTRACT_INVALID',
      status: longHistoryRecord.status || null,
      blockers: ['RESEARCH_READY_FAIL_CLOSED_CONTRACT_REQUIRED'],
      message: 'Long-history research record did not satisfy the fail-closed research-only contract and was ignored.',
    });
  }

  return {
    series: canonicalSeries || null,
    source: {
      type: 'CANONICAL_MARKET_HISTORY',
      researchOnly: false,
      status: canonicalSeries?.usable ? 'AVAILABLE' : 'UNAVAILABLE',
      policyVersion: null,
      source: canonicalSeries?.source || null,
      providerSymbol: canonicalSeries?.providerSymbol || null,
      observationCount: canonicalObservationCount,
      crossCheck: null,
    },
    diagnostics,
  };
}

export function buildShadowForecasts(input = {}) {
  const universe = Array.isArray(input.universe) ? input.universe : [];
  const universeByCompany = byId(universe);
  const opportunityMap = opportunityByInstrument(input.opportunityUniverse);
  const seriesCollector = input.historicalSeriesCollector instanceof Map ? input.historicalSeriesCollector : new Map();
  const longHistoryCollector = input.longHistoryResearchCollector instanceof Map ? input.longHistoryResearchCollector : new Map();
  const dossiers = Array.isArray(input.researchDossiers) ? input.researchDossiers : [];
  const generatedAt = new Date(input.generatedAt || Date.now()).toISOString();
  const output = [];

  for (const dossier of dossiers) {
    const company = universeByCompany.get(dossier.companyId) || {
      companyId: dossier.companyId,
      displayName: dossier.companyName,
      primaryListing: dossier.listing,
    };
    const profile = buildInstrumentProfile(company, input.options?.opportunityContext || {});
    const instrumentId = company.instrumentId || company.companyId || dossier.companyId;
    const canonicalSeries = seriesCollector.get(dossier.companyId) || null;
    const selectedHistory = selectPatternSeries(dossier.companyId, canonicalSeries, longHistoryCollector);
    const series = selectedHistory.series;
    const opportunity = opportunityMap.get(instrumentId) || null;
    const diagnostic = longHistoryDiagnostic(series, Number(input.options?.minimumShadowHistoryObservations || 520));

    const historicalPatternForecast = buildHistoricalPatternForecast({
      instrumentId,
      assetClass: profile.assetClass,
      series: series || { candles: [] },
      horizons: input.options?.shadowForecastHorizons,
      minAnalogCount: input.options?.shadowForecastMinAnalogCount || 18,
      maxAnalogs: input.options?.shadowForecastMaxAnalogs || 60,
      minEffectiveSample: input.options?.shadowForecastMinEffectiveSample || 10,
      sameRegimeOnly: input.options?.shadowForecastSameRegimeOnly !== false,
      minimumHistory: input.options?.shadowForecastMinimumHistory || 260,
      periodsPerYear: input.options?.shadowForecastPeriodsPerYear,
    });

    const driverSynthesis = synthesizeForecastDrivers({ dossier, opportunity: opportunity || {} });
    const forecast = buildProbabilisticForecastContract({
      historicalPatternForecast,
      generatedAt,
      instrumentId,
      displayName: dossier.companyName || company.displayName || company.legalName || null,
      assetClass: profile.assetClass,
      symbol: dossier.listing?.symbol || company.primaryListing?.symbol || null,
      exchange: dossier.listing?.exchange || company.primaryListing?.exchange || null,
      evidenceQualityScore: driverSynthesis.evidenceQualityScore,
      contradictionCount: driverSynthesis.contradictionCount,
      drivers: driverSynthesis.drivers,
      unknowns: driverSynthesis.unknowns,
      invalidationConditions: driverSynthesis.invalidationConditions,
    });

    output.push({
      format: 'investor-control-shadow-forecast',
      version: 1,
      policyVersion: SHADOW_FORECAST_ENGINE_VERSION,
      generatedAt,
      companyId: dossier.companyId,
      instrumentId,
      displayName: dossier.companyName || null,
      symbol: dossier.listing?.symbol || null,
      assetClass: profile.assetClass,
      analysisModel: profile.analysisModel,
      mode: 'SHADOW_ONLY',
      decisionImpact: 'NONE',
      finalActionEligible: false,
      historySource: selectedHistory.source,
      existingFinalActionSnapshot: dossier.finalAction || null,
      historicalPatternForecast,
      forecast,
      diagnostics: [...selectedHistory.diagnostics, ...(diagnostic ? [diagnostic] : [])],
    });
  }

  return output;
}

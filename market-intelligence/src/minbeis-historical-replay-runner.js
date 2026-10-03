import { buildMinbeisPointInTimeReplaySample } from './minbeis-point-in-time-replay.js';

export const MINBEIS_HISTORICAL_REPLAY_RUNNER_VERSION = '2026-10-03.1';

function seriesForCompany(source, companyId) {
  if (source instanceof Map) return source.get(companyId) || null;
  if (source && typeof source === 'object') return source[companyId] || null;
  return null;
}

function compactReplaySample(event, sample) {
  return {
    format: 'investor-control-minbeis-historical-replay-result',
    version: 1,
    policyVersion: MINBEIS_HISTORICAL_REPLAY_RUNNER_VERSION,
    eventArchiveId: event.eventArchiveId,
    companyId: event.companyId,
    companyName: event.companyName || null,
    symbol: event.symbol || null,
    eventType: event.eventType || null,
    category: event.category || null,
    role: event.role || null,
    availabilityAt: event.availabilityAt,
    replayStatus: sample.status,
    blockers: sample.blockers,
    decisionInputHash: sample.decisionInputHash,
    referencePrice: sample.decisionInput?.referencePrice ?? null,
    referencePriceAt: sample.decisionInput?.referencePriceAt || null,
    evidenceCount: sample.decisionInput?.evidence?.length || 0,
    knownEventCount: sample.decisionInput?.events?.length || 0,
    marketObservationCount: sample.decisionInput?.marketHistory?.length || 0,
    marketHistoryStartAt: sample.decisionInput?.marketHistory?.length
      ? new Date(sample.decisionInput.marketHistory[0].timestamp * 1000).toISOString()
      : null,
    marketHistoryEndAt: sample.decisionInput?.marketHistory?.length
      ? new Date(sample.decisionInput.marketHistory.at(-1).timestamp * 1000).toISOString()
      : null,
    excludedFutureEvidenceCount: sample.excludedFutureEvidenceCount,
    excludedUndatedEvidenceCount: sample.excludedUndatedEvidenceCount,
    excludedOrBlockedEventCount: sample.excludedOrBlockedEventCount,
    outcomes: sample.outcomeEvaluation,
    separationContract: sample.separationContract,
    decisionImpact: 'NONE',
  };
}

export function runMinbeisHistoricalEventReplay(input = {}) {
  const records = Array.isArray(input.eventArchiveRecords)
    ? input.eventArchiveRecords
    : Array.isArray(input.eventArchive?.records)
      ? input.eventArchive.records
      : [];
  const horizons = Array.isArray(input.horizons) && input.horizons.length
    ? input.horizons
    : [5, 21, 63];
  const results = [];
  const blocked = [];

  for (const event of records) {
    if (event?.replayEligible !== true || !event?.availabilityAt || !event?.companyId) {
      blocked.push({
        eventArchiveId: event?.eventArchiveId || null,
        companyId: event?.companyId || null,
        eventType: event?.eventType || null,
        blockers: event?.blockers?.length ? [...event.blockers] : ['EVENT_ARCHIVE_RECORD_NOT_REPLAY_ELIGIBLE'],
      });
      continue;
    }

    const marketSeries = seriesForCompany(input.historicalSeriesByCompany, event.companyId);
    if (!marketSeries?.candles?.length) {
      blocked.push({
        eventArchiveId: event.eventArchiveId,
        companyId: event.companyId,
        eventType: event.eventType || null,
        blockers: ['HISTORICAL_MARKET_SERIES_REQUIRED'],
      });
      continue;
    }

    const evidence = (Array.isArray(event.supportingEvidence) ? event.supportingEvidence : []).map((item) => ({
      id: item.evidenceId,
      evidenceId: item.evidenceId,
      sourceName: item.sourceName,
      sourceType: item.sourceType,
      sourceUrl: item.sourceUrl,
      title: item.title,
      publishedAt: item.publishedAt,
      contentHash: item.contentHash,
    }));
    const eventInput = [{
      eventId: event.eventArchiveId,
      eventType: event.eventType,
      category: event.category,
      statement: event.statement,
      publishedAt: event.availabilityAt,
      evidenceIds: event.evidenceIds,
    }];

    const sample = buildMinbeisPointInTimeReplaySample({
      asOf: event.availabilityAt,
      instrumentId: event.companyId,
      symbol: event.symbol,
      evidence,
      events: eventInput,
      marketSeries,
      horizons,
    });
    results.push(compactReplaySample(event, sample));
  }

  const ready = results.filter((item) => item.replayStatus === 'REPLAY_INPUT_READY');
  const maturedByHorizon = Object.fromEntries(horizons.map((days) => {
    const key = String(days);
    const matured = ready.filter((item) => item.outcomes?.[key]?.realisedReturnPct !== null && item.outcomes?.[key] !== null);
    return [key, {
      tradingDays: Number(days),
      replayCount: ready.length,
      maturedOutcomeCount: matured.length,
    }];
  }));

  return {
    format: 'investor-control-minbeis-historical-replay-run',
    version: 1,
    policyVersion: MINBEIS_HISTORICAL_REPLAY_RUNNER_VERSION,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    eventArchiveRecordCount: records.length,
    replayAttemptCount: results.length,
    replayReadyCount: ready.length,
    blockedCount: blocked.length + results.filter((item) => item.replayStatus !== 'REPLAY_INPUT_READY').length,
    horizons: maturedByHorizon,
    results,
    blocked,
    rawDecisionInputsPersisted: false,
    lookAheadPolicy: 'STRICT_POINT_IN_TIME_INFORMATION_ONLY',
    futureOutcomeDecisionVisibility: false,
    automaticPolicyMutationAllowed: false,
    decisionImpact: 'NONE',
  };
}

import { createHash } from 'node:crypto';
import { normalizeHistoricalSeries } from './historical-pattern-engine.js';

export const MINBEIS_POINT_IN_TIME_REPLAY_VERSION = '2026-10-03.1';

const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const round = (value, digits = 4) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function epochMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function iso(value) {
  const ms = epochMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function evidenceAvailability(record) {
  const publishedAt = iso(record?.publishedAt);
  return {
    publishedAt,
    availableAt: publishedAt,
    availabilitySource: publishedAt ? 'PUBLISHED_AT' : null,
  };
}

export function filterEvidenceKnownByAsOf(records = [], asOf) {
  const asOfMs = epochMs(asOf);
  if (asOfMs === null) throw new Error('Valid asOf timestamp is required');
  const known = [];
  const future = [];
  const undated = [];

  for (const record of Array.isArray(records) ? records : []) {
    const availability = evidenceAvailability(record);
    if (!availability.availableAt) {
      undated.push(record);
      continue;
    }
    if (epochMs(availability.availableAt) <= asOfMs) known.push(record);
    else future.push(record);
  }

  return {
    asOf: new Date(asOfMs).toISOString(),
    known,
    future,
    undated,
    strictReplayEligible: undated.length === 0,
    blockers: undated.length ? ['UNDATED_EVIDENCE_CANNOT_BE_USED_IN_STRICT_REPLAY'] : [],
  };
}

export function sliceMarketSeriesKnownByAsOf(series, asOf) {
  const asOfMs = epochMs(asOf);
  if (asOfMs === null) throw new Error('Valid asOf timestamp is required');
  const asOfSeconds = Math.floor(asOfMs / 1000);
  const candles = normalizeHistoricalSeries(series).filter((item) => item.timestamp <= asOfSeconds);
  return {
    asOf: new Date(asOfMs).toISOString(),
    candles,
    latestKnownCandle: candles.at(-1) || null,
  };
}

function eventIdentity(event = {}) {
  return {
    eventId: event.eventId || event.claimId || event.id || null,
    eventType: event.eventType || event.type || null,
    category: event.category || null,
    statement: event.statement || event.text || null,
    publishedAt: iso(event.publishedAt),
    evidenceIds: Array.isArray(event.evidenceIds) ? [...event.evidenceIds].sort() : [],
  };
}

export function filterEventsKnownByAsOf(events = [], evidenceKnownById = new Map(), asOf) {
  const asOfMs = epochMs(asOf);
  if (asOfMs === null) throw new Error('Valid asOf timestamp is required');
  const known = [];
  const blocked = [];

  for (const raw of Array.isArray(events) ? events : []) {
    const event = eventIdentity(raw);
    const explicitMs = epochMs(event.publishedAt);
    const evidenceDates = event.evidenceIds
      .map((id) => evidenceKnownById.get(id))
      .map((record) => epochMs(record?.publishedAt))
      .filter(Number.isFinite);
    const derivedMs = explicitMs || (evidenceDates.length ? Math.max(...evidenceDates) : null);
    if (derivedMs === null) {
      blocked.push({ ...event, blocker: 'EVENT_AVAILABILITY_TIME_UNKNOWN' });
      continue;
    }
    if (derivedMs > asOfMs) {
      blocked.push({ ...event, availableAt: new Date(derivedMs).toISOString(), blocker: 'EVENT_NOT_YET_KNOWN_AT_REPLAY_AS_OF' });
      continue;
    }
    known.push({ ...event, availableAt: new Date(derivedMs).toISOString() });
  }

  return { known, blocked };
}

function outcomeAt(candles, anchorIndex, horizonDays) {
  const start = candles[anchorIndex]?.close;
  const end = candles[anchorIndex + horizonDays]?.close;
  if (!finite(start) || !finite(end) || Number(start) <= 0) return null;
  const window = candles.slice(anchorIndex, anchorIndex + horizonDays + 1);
  const returns = window.map((item) => ((Number(item.close) - Number(start)) / Number(start)) * 100).filter(Number.isFinite);
  return {
    tradingDays: horizonDays,
    outcomeAt: new Date(candles[anchorIndex + horizonDays].timestamp * 1000).toISOString(),
    outcomePrice: Number(end),
    realisedReturnPct: round(((Number(end) - Number(start)) / Number(start)) * 100),
    maxFavorableExcursionPct: returns.length ? round(Math.max(...returns)) : null,
    maxAdverseExcursionPct: returns.length ? round(Math.min(...returns)) : null,
  };
}

export function buildMinbeisPointInTimeReplaySample(input = {}) {
  const asOfMs = epochMs(input.asOf);
  if (asOfMs === null) throw new Error('Valid asOf timestamp is required');
  const asOf = new Date(asOfMs).toISOString();

  const evidence = filterEvidenceKnownByAsOf(input.evidence, asOf);
  const evidenceById = new Map(evidence.known
    .filter((record) => record?.id || record?.evidenceId)
    .map((record) => [record.id || record.evidenceId, record]));
  const events = filterEventsKnownByAsOf(input.events, evidenceById, asOf);
  const marketKnown = sliceMarketSeriesKnownByAsOf(input.marketSeries, asOf);
  const fullSeries = normalizeHistoricalSeries(input.marketSeries);
  const anchor = marketKnown.latestKnownCandle;
  const anchorIndex = anchor ? fullSeries.findIndex((item) => item.timestamp === anchor.timestamp) : -1;

  const blockers = [
    ...evidence.blockers,
    ...(events.blocked.some((event) => event.blocker === 'EVENT_AVAILABILITY_TIME_UNKNOWN') ? ['UNDATED_EVENT_CANNOT_BE_USED_IN_STRICT_REPLAY'] : []),
    ...(anchorIndex < 0 ? ['REFERENCE_MARKET_PRICE_NOT_AVAILABLE_AT_AS_OF'] : []),
  ];

  const decisionInput = {
    format: 'minbeis-point-in-time-decision-input',
    version: 1,
    asOf,
    instrumentId: input.instrumentId || null,
    symbol: input.symbol || null,
    referencePrice: anchor ? Number(anchor.close) : null,
    referencePriceAt: anchor ? new Date(anchor.timestamp * 1000).toISOString() : null,
    evidence: evidence.known.map((record) => ({
      evidenceId: record.id || record.evidenceId || null,
      sourceName: record.sourceName || null,
      sourceType: record.sourceType || null,
      title: record.title || null,
      publishedAt: iso(record.publishedAt),
      contentHash: record.contentHash || null,
    })),
    events: events.known,
    marketHistory: marketKnown.candles,
  };

  const horizons = Array.isArray(input.horizons) && input.horizons.length
    ? input.horizons
    : [5, 21, 63];
  const outcomeEvaluation = Object.fromEntries(horizons
    .map((days) => [String(days), anchorIndex >= 0 ? outcomeAt(fullSeries, anchorIndex, Math.max(1, Number(days))) : null]));

  return {
    format: 'investor-control-minbeis-point-in-time-replay-sample',
    version: 1,
    policyVersion: MINBEIS_POINT_IN_TIME_REPLAY_VERSION,
    asOf,
    status: blockers.length ? 'BLOCKED' : 'REPLAY_INPUT_READY',
    blockers: [...new Set(blockers)],
    decisionInput,
    decisionInputHash: hash(decisionInput),
    excludedFutureEvidenceCount: evidence.future.length,
    excludedUndatedEvidenceCount: evidence.undated.length,
    excludedOrBlockedEventCount: events.blocked.length,
    outcomeEvaluation,
    separationContract: {
      futureOutcomeVisibleToDecision: false,
      postAsOfEvidenceVisibleToDecision: false,
      undatedEvidenceVisibleToDecision: false,
      outcomeEvaluationPurpose: 'EVALUATION_ONLY',
      decisionImpact: 'NONE',
    },
  };
}

export const MINBEIS_DECISION_CONTEXT_LEARNING_VERSION = '2026-10-03.1';

const BUY_ACTIONS = new Set(['BUY_PROBE', 'BUY_STARTER', 'BUY_CORE']);
const DEFENSIVE_ACTIONS = new Set(['NO_BUY', 'WATCH', 'REDUCE']);
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const round = (value, digits = 4) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function regimeLabel(snapshot) {
  if (!snapshot) return null;
  if (typeof snapshot === 'string') return snapshot.trim().toUpperCase() || null;
  const raw = snapshot.regime || snapshot.label || snapshot.marketRegime || snapshot.state || snapshot.riskRegime || null;
  return raw ? String(raw).trim().toUpperCase() : null;
}

function maturedObservation(record, horizon) {
  const outcome = record?.horizons?.[String(horizon)] || null;
  if (!record?.decisionId || outcome?.status !== 'MATURED') return null;
  const realised = finite(outcome.realisedReturnPct) ? Number(outcome.realisedReturnPct) : null;
  if (realised === null) return null;
  const excess = finite(outcome.excessReturnPct) ? Number(outcome.excessReturnPct) : null;
  const context = record.contextSnapshot || {};
  const research = context.research || {};
  const decision = context.decision || {};
  const direction = BUY_ACTIONS.has(record.action) || record.action === 'HOLD'
    ? 1
    : DEFENSIVE_ACTIONS.has(record.action)
      ? -1
      : 0;
  return {
    decisionId: record.decisionId,
    decisionDate: String(record.decisionAt || '').slice(0, 10),
    instrumentId: record.instrumentId || record.companyId || record.symbol || null,
    action: record.action,
    reason: decision.reason || record.decisionReason || null,
    regime: regimeLabel(research.marketRegimeSnapshot),
    leadEventType: research.leadEventType ? String(research.leadEventType).toUpperCase() : null,
    actionRegime: record.action && regimeLabel(research.marketRegimeSnapshot) ? `${record.action}|${regimeLabel(research.marketRegimeSnapshot)}` : null,
    actionLeadEvent: record.action && research.leadEventType ? `${record.action}|${String(research.leadEventType).toUpperCase()}` : null,
    actionReason: record.action && (decision.reason || record.decisionReason) ? `${record.action}|${decision.reason || record.decisionReason}` : null,
    catalystEventTypes: (Array.isArray(research.catalystEventTypes) ? research.catalystEventTypes : []).map((x) => String(x).toUpperCase()),
    riskEventTypes: (Array.isArray(research.riskEventTypes) ? research.riskEventTypes : []).map((x) => String(x).toUpperCase()),
    realisedReturnPct: realised,
    excessReturnPct: excess,
    decisionAlignedReturnPct: direction ? realised * direction : null,
    decisionAlignedExcessPct: direction && excess !== null ? excess * direction : null,
  };
}

function cohortStats(key, dimension, observations, options) {
  const sample = observations.filter((item) => item && item[dimension] === key);
  const distinctDates = new Set(sample.map((item) => item.decisionDate).filter(Boolean)).size;
  const distinctInstruments = new Set(sample.map((item) => item.instrumentId).filter(Boolean)).size;
  const aligned = sample.map((item) => item.decisionAlignedReturnPct).filter(Number.isFinite);
  const alignedExcess = sample.map((item) => item.decisionAlignedExcessPct).filter(Number.isFinite);
  const minimumSample = Math.max(5, Number(options.minimumSample || 20));
  const minimumDistinctDates = Math.max(2, Number(options.minimumDistinctDates || 5));
  const minimumDistinctInstruments = Math.max(2, Number(options.minimumDistinctInstruments || 5));
  const blockers = [];
  if (sample.length < minimumSample) blockers.push('COHORT_SAMPLE_TOO_SMALL');
  if (distinctDates < minimumDistinctDates) blockers.push('COHORT_DECISION_DATE_DIVERSITY_TOO_LOW');
  if (distinctInstruments < minimumDistinctInstruments) blockers.push('COHORT_INSTRUMENT_DIVERSITY_TOO_LOW');
  return {
    key,
    dimension,
    sampleSize: sample.length,
    distinctDecisionDates: distinctDates,
    distinctInstruments,
    evidenceReady: blockers.length === 0,
    blockers,
    positiveDecisionAlignedRatePct: aligned.length ? round(aligned.filter((value) => value > 0).length / aligned.length * 100, 2) : null,
    averageDecisionAlignedReturnPct: aligned.length ? round(aligned.reduce((a, b) => a + b, 0) / aligned.length) : null,
    averageDecisionAlignedExcessPct: alignedExcess.length ? round(alignedExcess.reduce((a, b) => a + b, 0) / alignedExcess.length) : null,
  };
}

function dimensionCohorts(observations, dimension, options) {
  const keys = [...new Set(observations.map((item) => item?.[dimension]).filter(Boolean))].sort();
  return keys.map((key) => cohortStats(key, dimension, observations, options));
}

function eventCohorts(observations, field, options) {
  const expanded = [];
  for (const observation of observations) {
    for (const event of observation?.[field] || []) expanded.push({ ...observation, event });
  }
  const keys = [...new Set(expanded.map((item) => item.event).filter(Boolean))].sort();
  return keys.map((key) => cohortStats(key, 'event', expanded.filter((item) => item.event === key).map((item) => ({ ...item, event: key })), options));
}

export function buildMinbeisDecisionContextLearning(records = [], options = {}) {
  const horizon = String(options.horizon || '30');
  const observations = (Array.isArray(records) ? records : [])
    .map((record) => maturedObservation(record, horizon))
    .filter(Boolean);

  const regime = dimensionCohorts(observations, 'regime', options);
  const leadEvent = dimensionCohorts(observations, 'leadEventType', options);
  const action = dimensionCohorts(observations, 'action', options);
  const reason = dimensionCohorts(observations, 'reason', options);
  const catalystEvent = eventCohorts(observations, 'catalystEventTypes', options);
  const riskEvent = eventCohorts(observations, 'riskEventTypes', options);
  const actionRegime = dimensionCohorts(observations, 'actionRegime', options);
  const actionLeadEvent = dimensionCohorts(observations, 'actionLeadEvent', options);
  const actionReason = dimensionCohorts(observations, 'actionReason', options);

  return {
    format: 'investor-control-minbeis-decision-context-learning',
    version: 1,
    policyVersion: MINBEIS_DECISION_CONTEXT_LEARNING_VERSION,
    horizon,
    maturedObservationCount: observations.length,
    cohorts: { regime, leadEvent, action, reason, actionRegime, actionLeadEvent, actionReason, catalystEvent, riskEvent },
    evidenceReadyCohortCount: [regime, leadEvent, action, reason, actionRegime, actionLeadEvent, actionReason, catalystEvent, riskEvent].flat().filter((item) => item.evidenceReady).length,
    automaticPolicyMutationAllowed: false,
    interpretation: 'Decision-aligned cohort statistics are observational associations. They do not establish causality and cannot change production policy without governed validation.',
  };
}

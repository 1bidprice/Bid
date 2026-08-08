import { contentHash } from './content-hash.js';

const HORIZONS = Object.freeze({
  day1: 1,
  week1: 7,
  month1: 30,
  month3: 90,
  month6: 180,
  month12: 365,
});

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function actionAlignedReturn(action, rawReturnPct) {
  if (!Number.isFinite(rawReturnPct)) return null;
  if (['CONSIDER_REDUCE', 'AVOID'].includes(action)) return round(-rawReturnPct, 4);
  if (['CONSIDER_BUY', 'HOLD'].includes(action)) return round(rawReturnPct, 4);
  return null;
}

function normalizedCandles(series) {
  return (Array.isArray(series?.candles) ? series.candles : [])
    .filter((candle) => Number.isFinite(Number(candle?.timestamp)) && Number(candle?.close) > 0)
    .map((candle) => ({ timestamp: Number(candle.timestamp), close: Number(candle.close) }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function checkpoint(candles, targetSeconds, referencePrice, action) {
  const candle = candles.find((item) => item.timestamp >= targetSeconds) || null;
  if (!candle) return null;
  const rawReturnPct = ((candle.close - referencePrice) / referencePrice) * 100;
  return {
    timestamp: new Date(candle.timestamp * 1000).toISOString(),
    close: candle.close,
    rawReturnPct: round(rawReturnPct, 4),
    actionAlignedReturnPct: actionAlignedReturn(action, rawReturnPct),
  };
}

export function createOutcomeRecord(dossier) {
  if (dossier?.status !== 'PUBLISHED') throw new Error('Outcome record requires a published dossier');
  if (!dossier?.referencePrice?.value || !dossier?.referencePrice?.timestamp) {
    throw new Error('Outcome record requires a reference price and timestamp');
  }
  const identity = {
    dossierId: dossier.dossierId,
    referencePrice: dossier.referencePrice,
    action: dossier.proposedAction,
  };
  return {
    outcomeId: `outcome:${contentHash(identity).slice(0, 24)}`,
    version: 1,
    dossierId: dossier.dossierId,
    companyId: dossier.companyId,
    companyName: dossier.companyName,
    symbol: dossier.listing?.symbol || null,
    exchange: dossier.listing?.exchange || null,
    category: dossier.category,
    action: dossier.proposedAction,
    publishedAt: dossier.generatedAt,
    referencePrice: dossier.referencePrice,
    checkpoints: Object.fromEntries(Object.keys(HORIZONS).map((key) => [key, null])),
    closeBasedExcursions: {
      maximumFavourablePct: null,
      maximumAdversePct: null,
      observationCount: 0,
    },
    catalystOutcome: 'PENDING',
    thesisOutcome: 'PENDING',
    lastEvaluatedAt: null,
    status: 'OPEN',
  };
}

export function evaluateOutcomeRecord(record, marketSeries, options = {}) {
  const candles = normalizedCandles(marketSeries);
  const referencePrice = Number(record?.referencePrice?.value);
  const referenceTimestamp = new Date(record?.referencePrice?.timestamp).getTime() / 1000;
  const asOf = new Date(options.asOf || Date.now());
  if (!Number.isFinite(referencePrice) || referencePrice <= 0 || !Number.isFinite(referenceTimestamp)) {
    throw new Error('Outcome evaluation requires a valid reference price and timestamp');
  }

  const postReference = candles.filter((candle) => candle.timestamp >= referenceTimestamp && candle.timestamp <= asOf.getTime() / 1000);
  const checkpoints = { ...record.checkpoints };
  for (const [key, days] of Object.entries(HORIZONS)) {
    const targetSeconds = referenceTimestamp + days * 86_400;
    if (targetSeconds <= asOf.getTime() / 1000) {
      checkpoints[key] = checkpoint(postReference, targetSeconds, referencePrice, record.action);
    }
  }

  const returns = postReference.map((candle) => ((candle.close - referencePrice) / referencePrice) * 100);
  const maxRaw = returns.length ? Math.max(...returns) : null;
  const minRaw = returns.length ? Math.min(...returns) : null;
  const shortAction = ['CONSIDER_REDUCE', 'AVOID'].includes(record.action);
  const maximumFavourablePct = shortAction ? (minRaw === null ? null : -minRaw) : maxRaw;
  const maximumAdversePct = shortAction ? (maxRaw === null ? null : -maxRaw) : minRaw;
  const finalHorizonReady = checkpoints.month12 !== null;

  return {
    ...record,
    checkpoints,
    closeBasedExcursions: {
      maximumFavourablePct: round(maximumFavourablePct, 4),
      maximumAdversePct: round(maximumAdversePct, 4),
      observationCount: postReference.length,
    },
    lastEvaluatedAt: asOf.toISOString(),
    status: finalHorizonReady ? 'MATURED' : 'OPEN',
  };
}

export function summarizeOutcomeLedger(records = []) {
  const evaluated = records.filter((record) => record?.lastEvaluatedAt);
  const scored = evaluated
    .map((record) => record.checkpoints?.month3?.actionAlignedReturnPct)
    .filter(Number.isFinite);
  const positive = scored.filter((value) => value > 0).length;
  return {
    format: 'investor-control-outcome-ledger-summary',
    version: 1,
    recordCount: records.length,
    evaluatedCount: evaluated.length,
    threeMonthScoredCount: scored.length,
    threeMonthPositiveCount: positive,
    threeMonthHitRatePct: scored.length ? round((positive / scored.length) * 100, 2) : null,
  };
}

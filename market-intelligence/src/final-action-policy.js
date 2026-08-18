export const FINAL_ACTION_POLICY_VERSION = '2026-08-18.2';

export const FINAL_ACTIONS = Object.freeze({
  BUY_NOW: 'BUY_NOW',
  SELL_NOW: 'SELL_NOW',
  HOLD: 'HOLD',
  DO_NOT_BUY: 'DO_NOT_BUY',
  AVOID: 'AVOID',
  WATCH: 'WATCH',
});

const SEVERE_FUNDAMENTAL_FLAGS = new Set([
  'CASH_RUNWAY_UNDER_ONE_YEAR',
  'SEVERE_DILUTION',
  'NON_POSITIVE_EQUITY',
  'VERY_HIGH_LIABILITIES_TO_ASSETS',
  'SEVERE_NEGATIVE_NET_MARGIN',
]);

const SEVERE_MARKET_FLAGS = new Set([
  'EXTREME_VOLATILITY',
  'SEVERE_DRAWDOWN',
  'LOW_LIQUIDITY',
]);

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function ageHours(now, timestamp) {
  if (!timestamp) return null;
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (now.getTime() - time) / 3_600_000);
}

function normalizedSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/\.(US|GR)$/i, '');
}

function actionLabel(action) {
  return {
    BUY_NOW: 'ΑΜΕΣΗ ΑΓΟΡΑ',
    SELL_NOW: 'ΑΜΕΣΗ ΠΩΛΗΣΗ / ΜΕΙΩΣΗ',
    HOLD: 'ΚΡΑΤΑ',
    DO_NOT_BUY: 'ΜΗΝ ΑΓΟΡΑΣΕΙΣ',
    AVOID: 'ΑΠΕΦΥΓΕ',
    WATCH: 'ΠΑΡΑΚΟΛΟΥΘΗΣΗ',
  }[action] || action;
}

function urgencyLabel(urgency) {
  return {
    IMMEDIATE: 'Άμεση ενέργεια',
    TODAY: 'Ενέργεια σήμερα',
    NORMAL: 'Κανονική παρακολούθηση',
    NONE: 'Χωρίς τελική ενέργεια',
  }[urgency] || urgency;
}

function decisionIntegrity(dossier) {
  const blockers = [];
  const companyId = dossier?.companyId || null;
  const proposed = dossier?.proposedAction || 'WATCH';
  const directional = proposed !== 'WATCH';
  const reference = dossier?.referencePrice || null;
  const listingSymbol = normalizedSymbol(dossier?.listing?.symbol);
  const referenceSymbol = normalizedSymbol(reference?.appSymbol || reference?.symbol || reference?.providerSymbol);
  const evidence = Array.isArray(dossier?.evidence) ? dossier.evidence : [];

  if (!companyId || companyId === 'company:unknown') blockers.push('COMPANY_IDENTITY_REQUIRED');

  if (directional) {
    if (!evidence.length) blockers.push('DECISION_EVIDENCE_REQUIRED');
    for (const record of evidence) {
      const ids = Array.isArray(record?.companyIds) ? record.companyIds.filter(Boolean) : [];
      if (!ids.length) blockers.push('EVIDENCE_ENTITY_UNVERIFIED');
      else if (companyId && !ids.includes(companyId)) blockers.push('EVIDENCE_ENTITY_MISMATCH');
    }

    if (reference?.companyId && companyId && reference.companyId !== companyId) blockers.push('REFERENCE_PRICE_ENTITY_MISMATCH');
    if (reference?.sourceApproved !== true) blockers.push('REFERENCE_PRICE_SOURCE_NOT_APPROVED');
    if (reference?.timestampVerified !== true) blockers.push('REFERENCE_PRICE_TIMESTAMP_NOT_VERIFIED');
    if (reference?.decisionEligible !== true) blockers.push('REFERENCE_PRICE_NOT_DECISION_ELIGIBLE');
    if (reference?.executionFreshnessEligible !== true) blockers.push('REFERENCE_PRICE_NOT_EXECUTION_ELIGIBLE');
    if (listingSymbol && referenceSymbol && listingSymbol !== referenceSymbol) blockers.push('LISTING_IDENTITY_MISMATCH');
  }

  if (proposed === 'CONSIDER_BUY') {
    if (dossier?.listingIntegrity?.activeTradingVerified !== true) blockers.push('ACTIVE_LISTING_NOT_VERIFIED');
    const lifecycle = String(dossier?.listingIntegrity?.lifecycleStatus || '').toUpperCase();
    if (['DELISTED', 'INACTIVE', 'PRIVATE', 'ACQUIRED', 'CEASED_TRADING'].includes(lifecycle)) blockers.push('LISTING_NOT_ACTIVE');
  }

  return {
    passed: blockers.length === 0,
    blockers: unique(blockers),
    companyId,
    listingSymbol: listingSymbol || null,
    referenceSymbol: referenceSymbol || null,
    evidenceCount: evidence.length,
  };
}

function dataQualityScore(dossier, integrity) {
  const crossCheck = dossier?.metrics?.crossCheck || {};
  const fundamentals = dossier?.metrics?.fundamentals || {};
  const market = dossier?.metrics?.market || {};
  const reference = dossier?.referencePrice || null;
  let score = 0;
  if (dossier?.readiness?.publishable === true) score += 15;
  if (crossCheck.recommendationReady === true) score += 20;
  if (fundamentals.metricsReady === true) score += 15;
  if (market.readiness?.marketMetricsReady === true) score += 15;
  if (reference?.timestamp && finite(reference?.value) > 0) score += 10;
  if (reference?.decisionEligible === true && reference?.sourceApproved === true && reference?.timestampVerified === true) score += 10;
  if ((dossier?.evidence || []).length >= 2) score += 5;
  if (integrity?.passed === true) score += 10;
  const raw = clamp(score);
  return integrity?.passed === true ? raw : Math.min(raw, 79);
}

function confidenceScore(dossier, flags, integrity) {
  const crossCheck = dossier?.metrics?.crossCheck || {};
  const market = dossier?.metrics?.market || {};
  const risk = dossier?.metrics?.fundamentalRisk || {};
  let score = 35;
  if (crossCheck.recommendationReady === true) score += 20;
  if (market.readiness?.marketMetricsReady === true) score += 15;
  if (risk.metricsReady === true) score += 10;
  if (finite(market.relativeStrength?.excessReturnPct) !== null) score += 5;
  if (finite(market.liquidity?.score) >= 65) score += 5;
  if (integrity?.passed === true) score += 10;
  score -= flags.severeFundamental.length * 8;
  score -= flags.severeMarket.length * 8;
  const raw = clamp(score);
  return integrity?.passed === true ? raw : Math.min(raw, 79);
}

function finalBlockers(dossier, now, options, integrity) {
  const blockers = [...(integrity?.blockers || [])];
  const market = dossier?.metrics?.market || null;
  const fundamentals = dossier?.metrics?.fundamentals || null;
  const crossCheck = dossier?.metrics?.crossCheck || null;
  const referencePriceAgeHours = ageHours(now, dossier?.referencePrice?.timestamp);
  const dossierAgeHours = ageHours(now, dossier?.generatedAt);
  const latestMarketAgeHours = market?.latestTimestamp
    ? ageHours(now, new Date(Number(market.latestTimestamp) * 1000).toISOString())
    : null;

  if (dossier?.readiness?.publishable !== true) blockers.push('DOSSIER_NOT_PUBLISHABLE');
  if (!['REVIEW_READY', 'PUBLISHED'].includes(dossier?.status)) blockers.push('DOSSIER_NOT_READY');
  if (crossCheck?.recommendationReady !== true) blockers.push('CROSS_CHECK_NOT_READY');
  if (fundamentals?.metricsReady !== true) blockers.push('FUNDAMENTALS_NOT_READY');
  if (market?.readiness?.marketMetricsReady !== true) blockers.push('MARKET_METRICS_NOT_READY');
  if (market?.dataQuality?.crossCheckReady === false) blockers.push('MARKET_HISTORY_NOT_CROSSCHECKED');
  if (!dossier?.referencePrice?.timestamp || finite(dossier?.referencePrice?.value) === null) blockers.push('REFERENCE_PRICE_REQUIRED');
  if (referencePriceAgeHours === null || referencePriceAgeHours > Number(options.maxReferencePriceAgeHours ?? 6)) blockers.push('REFERENCE_PRICE_STALE');
  if (dossierAgeHours === null || dossierAgeHours > Number(options.maxDossierAgeHours ?? 24)) blockers.push('DOSSIER_STALE');
  if (latestMarketAgeHours === null || latestMarketAgeHours > Number(options.maxHistoricalMarketAgeHours ?? 120)) blockers.push('MARKET_HISTORY_STALE');
  if (crossCheck?.contradictionCount > 0) blockers.push('UNRESOLVED_CONTRADICTION');
  if (!dossier?.reviewDate || new Date(`${dossier.reviewDate}T23:59:59.999Z`) < now) blockers.push('REVIEW_DATE_EXPIRED');
  return {
    blockers: unique(blockers),
    referencePriceAgeHours,
    dossierAgeHours,
    latestMarketAgeHours,
    executionFreshnessEligible: dossier?.referencePrice?.executionFreshnessEligible === true,
  };
}

function riskFlags(dossier) {
  const fundamental = dossier?.metrics?.fundamentalRisk?.flags || [];
  const market = dossier?.metrics?.market?.risk?.flags || [];
  return {
    fundamental,
    market,
    severeFundamental: fundamental.filter((flag) => SEVERE_FUNDAMENTAL_FLAGS.has(flag)),
    severeMarket: market.filter((flag) => SEVERE_MARKET_FLAGS.has(flag)),
  };
}

function determineActions(dossier, flags, confidence, now, options) {
  const proposed = dossier?.proposedAction || 'WATCH';
  const market = dossier?.metrics?.market || {};
  const riskScore = finite(dossier?.metrics?.fundamentalRisk?.riskScore) ?? 100;
  const liquidityScore = finite(market?.liquidity?.score) ?? 0;
  const relativeStrength = finite(market?.relativeStrength?.excessReturnPct);
  const distance50 = finite(market?.trend?.distanceFromSma50Pct);
  const distance200 = finite(market?.trend?.distanceFromSma200Pct);
  const priceAge = ageHours(now, dossier?.referencePrice?.timestamp);
  const immediateFresh = priceAge !== null && priceAge <= Number(options.immediatePriceAgeHours ?? 2);
  const severeRisk = flags.severeFundamental.length > 0 || flags.severeMarket.length > 0 || riskScore >= 85;
  const weakTrend = (relativeStrength !== null && relativeStrength < -10) || (distance50 !== null && distance50 < -8);
  const positiveTrend = (relativeStrength ?? -999) > 0 && (distance50 ?? -999) > 0 && (distance200 === null || distance200 > -3);
  const adequateLiquidity = liquidityScore >= Number(options.minimumImmediateLiquidityScore ?? 65);

  if (severeRisk) {
    return {
      marketAction: FINAL_ACTIONS.AVOID,
      holderAction: FINAL_ACTIONS.SELL_NOW,
      nonHolderAction: FINAL_ACTIONS.AVOID,
      urgency: immediateFresh ? 'IMMEDIATE' : 'TODAY',
      reasons: ['SEVERE_RISK_CONFIGURATION'],
    };
  }

  if (proposed === 'CONSIDER_REDUCE') {
    return {
      marketAction: FINAL_ACTIONS.DO_NOT_BUY,
      holderAction: FINAL_ACTIONS.SELL_NOW,
      nonHolderAction: FINAL_ACTIONS.DO_NOT_BUY,
      urgency: immediateFresh ? 'IMMEDIATE' : 'TODAY',
      reasons: ['DIRECTIONAL_REDUCTION_SIGNAL'],
    };
  }

  if (proposed === 'AVOID') {
    return {
      marketAction: FINAL_ACTIONS.AVOID,
      holderAction: weakTrend ? FINAL_ACTIONS.SELL_NOW : FINAL_ACTIONS.HOLD,
      nonHolderAction: FINAL_ACTIONS.AVOID,
      urgency: weakTrend && immediateFresh ? 'IMMEDIATE' : 'TODAY',
      reasons: ['AVOIDANCE_SIGNAL'],
    };
  }

  if (proposed === 'CONSIDER_BUY') {
    if (immediateFresh && adequateLiquidity && positiveTrend && riskScore <= 55 && confidence >= 80) {
      return {
        marketAction: FINAL_ACTIONS.BUY_NOW,
        holderAction: FINAL_ACTIONS.HOLD,
        nonHolderAction: FINAL_ACTIONS.BUY_NOW,
        urgency: 'IMMEDIATE',
        reasons: ['BUY_GATES_CONFIRMED'],
      };
    }
    return {
      marketAction: FINAL_ACTIONS.WATCH,
      holderAction: FINAL_ACTIONS.HOLD,
      nonHolderAction: FINAL_ACTIONS.DO_NOT_BUY,
      urgency: 'NORMAL',
      reasons: ['BUY_SETUP_NOT_CONFIRMED'],
    };
  }

  if (proposed === 'HOLD') {
    return {
      marketAction: FINAL_ACTIONS.HOLD,
      holderAction: FINAL_ACTIONS.HOLD,
      nonHolderAction: FINAL_ACTIONS.WATCH,
      urgency: 'NORMAL',
      reasons: ['THESIS_REMAINS_VALID'],
    };
  }

  return {
    marketAction: FINAL_ACTIONS.WATCH,
    holderAction: FINAL_ACTIONS.WATCH,
    nonHolderAction: FINAL_ACTIONS.WATCH,
    urgency: 'NONE',
    reasons: ['NO_DIRECTIONAL_SIGNAL'],
  };
}

export function evaluateFinalAction(dossier, options = {}) {
  const now = new Date(options.now || Date.now());
  const integrity = decisionIntegrity(dossier);
  const freshness = finalBlockers(dossier, now, options, integrity);
  const flags = riskFlags(dossier);
  const quality = dataQualityScore(dossier, integrity);
  const confidence = confidenceScore(dossier, flags, integrity);
  const blocked = freshness.blockers.length > 0;
  const actions = blocked
    ? {
        marketAction: FINAL_ACTIONS.WATCH,
        holderAction: FINAL_ACTIONS.WATCH,
        nonHolderAction: FINAL_ACTIONS.WATCH,
        urgency: 'NONE',
        reasons: ['FINAL_ACTION_BLOCKED'],
      }
    : determineActions(dossier, flags, confidence, now, options);
  const validForHours = actions.urgency === 'IMMEDIATE' ? 2 : actions.urgency === 'TODAY' ? 8 : 24;
  const generatedAt = now.toISOString();

  return {
    format: 'investor-control-final-action',
    version: 2,
    policyVersion: FINAL_ACTION_POLICY_VERSION,
    generatedAt,
    validUntil: new Date(now.getTime() + validForHours * 3_600_000).toISOString(),
    status: blocked ? 'BLOCKED' : 'FINAL',
    marketAction: actions.marketAction,
    marketActionLabel: actionLabel(actions.marketAction),
    holderAction: actions.holderAction,
    holderActionLabel: actionLabel(actions.holderAction),
    nonHolderAction: actions.nonHolderAction,
    nonHolderActionLabel: actionLabel(actions.nonHolderAction),
    urgency: actions.urgency,
    urgencyLabel: urgencyLabel(actions.urgency),
    confidenceScore: confidence,
    confidenceMeaning: 'POLICY_COMPLETENESS_HEURISTIC_NOT_PROBABILITY',
    dataQualityScore: quality,
    reasons: unique(actions.reasons),
    blockers: freshness.blockers,
    integrity,
    freshness: {
      referencePriceAgeHours: freshness.referencePriceAgeHours,
      dossierAgeHours: freshness.dossierAgeHours,
      latestMarketAgeHours: freshness.latestMarketAgeHours,
      executionFreshnessEligible: freshness.executionFreshnessEligible,
    },
    risk: {
      riskScore: finite(dossier?.metrics?.fundamentalRisk?.riskScore),
      fundamentalFlags: flags.fundamental,
      marketFlags: flags.market,
    },
    execution: {
      automaticBrokerOrder: false,
      requiresUserExecution: true,
    },
  };
}

export function applyAutonomousPublicationPolicy(dossiers = [], options = {}) {
  return dossiers.map((dossier) => {
    const finalAction = evaluateFinalAction(dossier, options);
    const autoPublish = finalAction.status === 'FINAL' && finalAction.marketAction !== FINAL_ACTIONS.WATCH;
    return {
      ...dossier,
      status: autoPublish ? 'PUBLISHED' : dossier.status,
      publicationMode: autoPublish ? 'AUTOMATED_POLICY' : null,
      finalAction,
    };
  });
}

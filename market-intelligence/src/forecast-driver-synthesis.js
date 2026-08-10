export const FORECAST_DRIVER_SYNTHESIS_VERSION = '2026-08-11.1';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function createDriver({ name, family, direction, strengthScore, explanation, verified = true, evidenceIds = [], sourceCount = 0, asOf = null, components = {} }) {
  return {
    name,
    family,
    direction,
    strengthScore: Number(clamp(strengthScore).toFixed(2)),
    verified,
    explanation,
    evidenceIds: unique(evidenceIds),
    sourceCount: Math.max(0, Number(sourceCount || 0)),
    asOf,
    components,
  };
}

function factorDrivers(opportunity = {}) {
  const factors = opportunity?.factors || opportunity?.opportunityFactors || {};
  const labels = {
    valuation: ['Αποτίμηση έναντι ομοειδών', 'VALUATION'],
    quality: ['Ποιότητα επιχείρησης', 'QUALITY'],
    growth: ['Ανάπτυξη', 'GROWTH'],
    momentum: ['Momentum έναντι ομοειδών', 'MOMENTUM'],
    catalyst: ['Καταλύτες', 'CATALYST'],
    balanceSheet: ['Ισολογισμός', 'BALANCE_SHEET'],
    diversificationBenefit: ['Όφελος διαφοροποίησης', 'PORTFOLIO'],
  };
  const output = [];
  for (const [key, [label, family]] of Object.entries(labels)) {
    const factor = factors?.[key];
    const score = finite(typeof factor === 'number' ? factor : factor?.score);
    if (score === null) continue;
    const verified = typeof factor === 'number' ? false : factor?.verified === true;
    const direction = score >= 65 ? 'POSITIVE' : score <= 35 ? 'NEGATIVE' : 'NEUTRAL';
    output.push(createDriver({
      name: key.toUpperCase(),
      family,
      direction,
      strengthScore: Math.abs(score - 50) * 2,
      verified,
      explanation: `${label}: ${score.toFixed(1)}/100${factor?.peerSampleSize ? ` σε cohort ${factor.peerSampleSize} ομοειδών` : ''}.`,
      sourceCount: factor?.sourceCount || 0,
      asOf: factor?.asOf || null,
      components: factor?.components || {},
    }));
  }
  return output;
}

function marketDrivers(market = {}) {
  const output = [];
  const rs = finite(market?.relativeStrength?.excessReturnPct);
  if (rs !== null) {
    output.push(createDriver({
      name: 'RELATIVE_STRENGTH',
      family: 'MOMENTUM',
      direction: rs >= 5 ? 'POSITIVE' : rs <= -5 ? 'NEGATIVE' : 'NEUTRAL',
      strengthScore: Math.min(100, 45 + Math.abs(rs) * 2.5),
      explanation: `Σχετική απόδοση 60 περιόδων έναντι benchmark: ${rs.toFixed(2)}%.`,
      verified: market?.readiness?.relativeStrengthReady === true,
      asOf: market?.latestTimestamp ? new Date(Number(market.latestTimestamp) * 1000).toISOString() : null,
      components: { excessReturnPct: rs, benchmarkSymbol: market?.benchmarkSymbol || null },
    }));
  }

  const d50 = finite(market?.trend?.distanceFromSma50Pct);
  const d200 = finite(market?.trend?.distanceFromSma200Pct);
  if (d50 !== null || d200 !== null) {
    const bothPositive = (d50 ?? 0) > 0 && (d200 ?? 0) > 0;
    const bothNegative = (d50 ?? 0) < 0 && (d200 ?? 0) < 0;
    const magnitude = [d50, d200].filter(Number.isFinite).reduce((sum, value) => sum + Math.abs(value), 0) / [d50, d200].filter(Number.isFinite).length;
    output.push(createDriver({
      name: 'TREND_REGIME',
      family: 'MOMENTUM',
      direction: bothPositive ? 'POSITIVE' : bothNegative ? 'NEGATIVE' : 'NEUTRAL',
      strengthScore: Math.min(100, 45 + magnitude * 3),
      explanation: `Απόσταση από SMA50: ${d50 === null ? 'n/a' : `${d50.toFixed(2)}%`}, από SMA200: ${d200 === null ? 'n/a' : `${d200.toFixed(2)}%`}.`,
      verified: market?.readiness?.priceHistoryReady === true,
      components: { distanceFromSma50Pct: d50, distanceFromSma200Pct: d200 },
    }));
  }

  const volatility = finite(market?.risk?.annualizedVolatility60Pct);
  if (volatility !== null) {
    output.push(createDriver({
      name: 'VOLATILITY',
      family: 'RISK',
      direction: volatility >= 50 ? 'NEGATIVE' : 'NEUTRAL',
      strengthScore: volatility >= 80 ? 95 : volatility >= 50 ? 75 : Math.min(55, volatility),
      explanation: `Ετησιοποιημένη μεταβλητότητα 60 περιόδων: ${volatility.toFixed(2)}%.`,
      verified: market?.readiness?.priceHistoryReady === true,
      components: { annualizedVolatility60Pct: volatility },
    }));
  }

  const drawdown = finite(market?.risk?.maxDrawdown120Pct);
  if (drawdown !== null) {
    output.push(createDriver({
      name: 'DRAWDOWN',
      family: 'RISK',
      direction: drawdown <= -30 ? 'NEGATIVE' : 'NEUTRAL',
      strengthScore: drawdown <= -50 ? 95 : drawdown <= -30 ? 75 : Math.min(55, Math.abs(drawdown) * 2),
      explanation: `Μέγιστο drawdown 120 περιόδων: ${drawdown.toFixed(2)}%.`,
      verified: market?.readiness?.priceHistoryReady === true,
      components: { maxDrawdown120Pct: drawdown },
    }));
  }

  const liquidity = finite(market?.liquidity?.score);
  if (liquidity !== null) {
    output.push(createDriver({
      name: 'LIQUIDITY',
      family: 'EXECUTION',
      direction: liquidity < 45 ? 'NEGATIVE' : 'NEUTRAL',
      strengthScore: liquidity < 45 ? 80 - liquidity : Math.min(70, liquidity),
      explanation: `Βαθμός ρευστότητας: ${liquidity.toFixed(1)}/100. Η υψηλή ρευστότητα βελτιώνει την εκτέλεση αλλά δεν θεωρείται από μόνη της ανοδικό σήμα.`,
      verified: market?.readiness?.liquidityReady === true,
      components: { liquidityScore: liquidity, averageDailyValueTraded20: finite(market?.liquidity?.averageDailyValueTraded20) },
    }));
  }
  return output;
}

function fundamentalDrivers(risk = {}) {
  const output = [];
  const margin = finite(risk?.profitability?.netMarginPct);
  if (margin !== null) {
    output.push(createDriver({
      name: 'PROFITABILITY',
      family: 'FUNDAMENTAL',
      direction: margin > 0 ? 'POSITIVE' : 'NEGATIVE',
      strengthScore: Math.min(100, 50 + Math.abs(margin)),
      explanation: `Καθαρό περιθώριο: ${margin.toFixed(2)}%.`,
      verified: risk?.metricsReady === true,
      components: { netMarginPct: margin },
    }));
  }

  const fcf = finite(risk?.profitability?.freeCashFlow);
  if (fcf !== null) {
    output.push(createDriver({
      name: 'FREE_CASH_FLOW',
      family: 'FUNDAMENTAL',
      direction: fcf > 0 ? 'POSITIVE' : fcf < 0 ? 'NEGATIVE' : 'NEUTRAL',
      strengthScore: fcf === 0 ? 40 : 70,
      explanation: `Free cash flow: ${fcf.toLocaleString('en-US')}.`,
      verified: risk?.metricsReady === true,
      components: { freeCashFlow: fcf },
    }));
  }

  const dilution = finite(risk?.capitalStructure?.dilutedSharesChangePct);
  if (dilution !== null && Math.abs(dilution) >= 3) {
    output.push(createDriver({
      name: 'DILUTION',
      family: 'CAPITAL_STRUCTURE',
      direction: dilution >= 3 ? 'NEGATIVE' : 'POSITIVE',
      strengthScore: Math.min(100, 45 + Math.abs(dilution) * 2),
      explanation: `Μεταβολή diluted shares: ${dilution.toFixed(2)}%.`,
      verified: risk?.metricsReady === true,
      components: { dilutedSharesChangePct: dilution },
    }));
  }

  const runway = finite(risk?.balanceSheet?.cashRunwayYears);
  if (runway !== null) {
    output.push(createDriver({
      name: 'CASH_RUNWAY',
      family: 'BALANCE_SHEET',
      direction: runway < 2 ? 'NEGATIVE' : 'NEUTRAL',
      strengthScore: runway < 1 ? 95 : runway < 2 ? 80 : 45,
      explanation: `Εκτιμώμενο cash runway με τον τρέχοντα ρυθμό FCF: ${runway.toFixed(2)} έτη.`,
      verified: risk?.metricsReady === true,
      components: { cashRunwayYears: runway },
    }));
  }

  for (const flag of unique(risk?.flags || [])) {
    output.push(createDriver({
      name: `RISK_${flag}`,
      family: 'RISK',
      direction: 'NEGATIVE',
      strengthScore: /SEVERE|NON_POSITIVE|VERY_HIGH|UNDER_ONE/.test(flag) ? 95 : 75,
      explanation: `Επαληθευμένο fundamental risk flag: ${flag}.`,
      verified: risk?.metricsReady === true,
      components: { flag },
    }));
  }
  return output;
}

function claimDrivers(dossier = {}) {
  const output = [];
  for (const catalyst of dossier?.catalysts || []) {
    output.push(createDriver({
      name: 'VERIFIED_CATALYST',
      family: 'CATALYST',
      direction: 'POSITIVE',
      strengthScore: Math.max(50, Number(catalyst.confidence || 0) * 100),
      explanation: catalyst.text || 'Verified catalyst',
      verified: Array.isArray(catalyst.evidenceIds) && catalyst.evidenceIds.length > 0,
      evidenceIds: catalyst.evidenceIds || [],
      sourceCount: catalyst.evidenceIds?.length || 0,
    }));
  }
  for (const risk of dossier?.risks || []) {
    output.push(createDriver({
      name: 'VERIFIED_THESIS_RISK',
      family: 'RISK',
      direction: 'NEGATIVE',
      strengthScore: Math.max(50, Number(risk.confidence || 0) * 100),
      explanation: risk.text || 'Verified thesis risk',
      verified: Array.isArray(risk.evidenceIds) && risk.evidenceIds.length > 0,
      evidenceIds: risk.evidenceIds || [],
      sourceCount: risk.evidenceIds?.length || 0,
    }));
  }
  return output;
}

function evidenceQuality(dossier = {}, opportunity = {}) {
  const explicit = finite(opportunity?.evidenceQualityScore);
  if (explicit !== null) return clamp(explicit);
  let score = 0;
  if (dossier?.readiness?.publishable === true) score += 30;
  if (dossier?.metrics?.crossCheck?.recommendationReady === true) score += 30;
  if (dossier?.metrics?.fundamentalRisk?.metricsReady === true) score += 20;
  if (dossier?.metrics?.market?.readiness?.marketMetricsReady === true) score += 20;
  return clamp(score);
}

export function synthesizeForecastDrivers(input = {}) {
  const dossier = input.dossier || input;
  const opportunity = input.opportunity || {};
  const drivers = [
    ...factorDrivers(opportunity),
    ...marketDrivers(dossier?.metrics?.market || {}),
    ...fundamentalDrivers(dossier?.metrics?.fundamentalRisk || {}),
    ...claimDrivers(dossier),
  ];
  const blockers = unique(dossier?.readiness?.blockers || []);
  const missingFactors = unique(opportunity?.missingFactors || []);
  const contradictionCount = Math.max(0, Number(opportunity?.contradictionCount ?? dossier?.metrics?.crossCheck?.contradictionCount ?? 0));

  return {
    format: 'investor-control-forecast-drivers',
    version: 1,
    policyVersion: FORECAST_DRIVER_SYNTHESIS_VERSION,
    instrumentId: dossier?.companyId || opportunity?.instrumentId || null,
    drivers,
    evidenceQualityScore: evidenceQuality(dossier, opportunity),
    contradictionCount,
    unknowns: unique([
      ...blockers.map((item) => `READINESS:${item}`),
      ...missingFactors.map((item) => `MISSING_FACTOR:${item}`),
    ]),
    invalidationConditions: unique([dossier?.invalidationCondition]),
    invariants: {
      absoluteValuationIsNotCalledCheapWithoutPeerNormalizedEvidence: true,
      highLiquidityIsNotAutomaticallyBullish: true,
      unverifiedDriversMustBeExcludedByForecastContract: true,
    },
  };
}

import { ASSET_CLASS } from './instrument-profile.js';

export const OPPORTUNITY_FACTOR_ENGINE_VERSION = '2026-08-09.2';

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));
const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const avg = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};
const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function percentileRank(values, value, higherIsBetter = true) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!Number.isFinite(value) || valid.length < 2) return null;
  const lower = valid.filter((item) => item < value).length;
  const equal = valid.filter((item) => item === value).length;
  const percentile = ((lower + Math.max(0, equal - 1) / 2) / Math.max(1, valid.length - 1)) * 100;
  return clamp(higherIsBetter ? percentile : 100 - percentile);
}

function peerKey(record, level) {
  const profile = record.profile || {};
  if (level === 0) return [profile.assetClass, profile.analysisModel, record.sector || record.industry || null].filter(Boolean).join('|');
  if (level === 1) return [profile.assetClass, profile.analysisModel].filter(Boolean).join('|');
  return profile.assetClass || 'UNKNOWN';
}

function specializedEquityModel(profile = {}) {
  return profile.assetClass === ASSET_CLASS.EQUITY && profile.analysisModel && profile.analysisModel !== 'EQUITY_OPERATING';
}

function choosePeers(record, universe, minimumPeers = 5) {
  const sectorKey = peerKey(record, 0);
  const sectorPeers = universe.filter((item) => peerKey(item, 0) === sectorKey);
  if (sectorPeers.length >= minimumPeers) return { peers: sectorPeers, level: 0, key: sectorKey };

  const modelKey = peerKey(record, 1);
  const modelPeers = universe.filter((item) => peerKey(item, 1) === modelKey);
  if (modelPeers.length >= minimumPeers) return { peers: modelPeers, level: 1, key: modelKey };

  // A bank, REIT, insurer, SPAC or other specialized equity must never be
  // normalized against ordinary operating companies merely to inflate the
  // cohort. Small specialized cohorts remain explicitly insufficient.
  if (specializedEquityModel(record.profile)) return { peers: modelPeers, level: 1, key: modelKey };

  const classKey = peerKey(record, 2);
  const sameClass = universe.filter((item) => peerKey(item, 2) === classKey);
  return { peers: sameClass, level: 2, key: classKey };
}

function factor(score, meta = {}) {
  return Number.isFinite(score) ? {
    score: round(clamp(score)),
    verified: meta.verified !== false,
    sourceCount: Math.max(1, Number(meta.sourceCount || 2)),
    ageHours: Number.isFinite(Number(meta.ageHours)) ? Number(meta.ageHours) : null,
    peerSampleSize: Number(meta.peerSampleSize || 0),
    peerKey: meta.peerKey || null,
    components: meta.components || {},
    policyVersion: OPPORTUNITY_FACTOR_ENGINE_VERSION,
  } : null;
}

function scorePeerMetric(record, peers, path, higherIsBetter = true) {
  const values = peers.map((item) => finite(path(item.rawSignals || {}))).filter(Number.isFinite);
  const own = finite(path(record.rawSignals || {}));
  return percentileRank(values, own, higherIsBetter);
}

function equityFactors(record, peers, peerMeta) {
  const raw = record.rawSignals || {};
  const ps = scorePeerMetric(record, peers, (x) => x.priceToSales, false);
  const pb = raw.priceToBook !== null && raw.priceToBook > 0
    ? scorePeerMetric(record, peers.filter((item) => finite(item.rawSignals?.priceToBook) > 0), (x) => x.priceToBook, false)
    : null;
  const valuation = avg([ps, pb]);

  const margin = scorePeerMetric(record, peers, (x) => x.netMarginPct, true);
  const fcfMargin = scorePeerMetric(record, peers, (x) => x.freeCashFlowMarginPct, true);
  const quality = avg([margin, fcfMargin]);

  const revenueGrowth = scorePeerMetric(record, peers, (x) => x.revenueGrowthPct, true);
  const growth = revenueGrowth;

  const relStrength = scorePeerMetric(record, peers, (x) => x.relativeStrength60Pct, true);
  const return120 = scorePeerMetric(record, peers, (x) => x.return120Pct, true);
  const trend200 = scorePeerMetric(record, peers, (x) => x.distanceFromSma200Pct, true);
  let momentum = avg([relStrength, return120, trend200]);
  if (finite(raw.maxDrawdown120Pct) !== null && raw.maxDrawdown120Pct <= -50) momentum = Math.min(momentum ?? 0, 25);

  const liabilities = scorePeerMetric(record, peers, (x) => x.liabilitiesToAssetsPct, false);
  const dilution = scorePeerMetric(record, peers, (x) => x.dilutedSharesChangePct, false);
  const runway = scorePeerMetric(record, peers, (x) => x.cashRunwayYears, true);
  let balanceSheet = avg([liabilities, dilution, runway]);
  if (raw.nonPositiveEquity === true) balanceSheet = Math.min(balanceSheet ?? 0, 10);
  if (finite(raw.cashRunwayYears) !== null && raw.cashRunwayYears < 1) balanceSheet = Math.min(balanceSheet ?? 0, 20);

  const liquidity = finite(raw.liquidityScore);
  const catalyst = finite(raw.catalystScore);
  const diversificationBenefit = finite(raw.diversificationBenefitScore);
  const meta = {
    peerSampleSize: peers.length,
    peerKey: peerMeta.key,
    sourceCount: record.sourceCount || 2,
    ageHours: record.ageHours,
  };

  return {
    valuation: factor(valuation, { ...meta, components: { priceToSalesPercentile: ps, priceToBookPercentile: pb } }),
    quality: factor(quality, { ...meta, components: { netMarginPercentile: margin, freeCashFlowMarginPercentile: fcfMargin } }),
    growth: factor(growth, { ...meta, components: { revenueGrowthPercentile: revenueGrowth } }),
    momentum: factor(momentum, { ...meta, components: { relativeStrength60Percentile: relStrength, return120Percentile: return120, sma200DistancePercentile: trend200 } }),
    catalyst: factor(catalyst, { ...meta, components: { deterministicCatalystScore: catalyst } }),
    balanceSheet: factor(balanceSheet, { ...meta, components: { liabilitiesPercentile: liabilities, dilutionPercentile: dilution, runwayPercentile: runway } }),
    liquidity: factor(liquidity, { ...meta, components: { liquidityScore: liquidity } }),
    diversificationBenefit: factor(diversificationBenefit, { ...meta, components: { portfolioDiversificationScore: diversificationBenefit } }),
  };
}

function cleanFactors(factors) {
  return Object.fromEntries(Object.entries(factors).filter(([, value]) => value !== null));
}

export function extractEquityOpportunityRawSignals(input = {}) {
  const fundamentals = input.fundamentals || {};
  const risk = input.fundamentalRisk || {};
  const market = input.marketMetrics || {};
  const revenue = finite(risk.profitability?.revenue);
  const freeCashFlow = finite(risk.profitability?.freeCashFlow);
  return {
    priceToSales: finite(risk.valuation?.priceToSales),
    priceToBook: finite(risk.valuation?.priceToBook),
    netMarginPct: finite(risk.profitability?.netMarginPct ?? fundamentals.metrics?.annualNetMarginPct),
    freeCashFlowMarginPct: revenue && freeCashFlow !== null ? (freeCashFlow / Math.abs(revenue)) * 100 : null,
    revenueGrowthPct: finite(fundamentals.metrics?.annualRevenueGrowthPct),
    liabilitiesToAssetsPct: finite(risk.balanceSheet?.liabilitiesToAssetsPct),
    cashRunwayYears: finite(risk.balanceSheet?.cashRunwayYears),
    dilutedSharesChangePct: finite(risk.capitalStructure?.dilutedSharesChangePct ?? fundamentals.metrics?.dilutedSharesChangePct),
    nonPositiveEquity: Array.isArray(risk.flags) && risk.flags.includes('NON_POSITIVE_EQUITY'),
    relativeStrength60Pct: finite(market.relativeStrength?.excessReturnPct),
    return120Pct: finite(market.returnsPct?.d120),
    distanceFromSma200Pct: finite(market.trend?.distanceFromSma200Pct),
    maxDrawdown120Pct: finite(market.risk?.maxDrawdown120Pct),
    annualizedVolatility60Pct: finite(market.risk?.annualizedVolatility60Pct),
    liquidityScore: finite(market.liquidity?.score),
    catalystScore: finite(input.catalystScore),
    diversificationBenefitScore: finite(input.diversificationBenefitScore),
  };
}

export function buildOpportunityFactorsForUniverse(records = [], options = {}) {
  const minimumPeers = Math.max(3, Number(options.minimumPeers || 5));
  const output = [];

  for (const record of records) {
    const profile = record.profile || {};
    const peerMeta = choosePeers(record, records, minimumPeers);
    let factors = {};
    if (profile.assetClass === ASSET_CLASS.EQUITY) {
      factors = cleanFactors(equityFactors(record, peerMeta.peers, peerMeta));
    } else if (record.rawFactors && typeof record.rawFactors === 'object') {
      factors = cleanFactors(record.rawFactors);
    }

    output.push({
      ...record,
      opportunityFactors: factors,
      peerNormalization: {
        policyVersion: OPPORTUNITY_FACTOR_ENGINE_VERSION,
        peerKey: peerMeta.key,
        peerLevel: peerMeta.level,
        peerSampleSize: peerMeta.peers.length,
        minimumPeers,
        sufficientPeerSample: peerMeta.peers.length >= minimumPeers,
      },
    });
  }
  return output;
}

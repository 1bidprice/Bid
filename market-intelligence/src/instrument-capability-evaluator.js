export const CAPABILITY_EVALUATOR_VERSION = '2026-08-08.1';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function cap(input, key) {
  return input?.capabilities?.[key] ?? null;
}

function capValue(input, key, field = 'value') {
  const capability = cap(input, key);
  if (capability && typeof capability === 'object' && !Array.isArray(capability)) return finite(capability[field]);
  return finite(capability);
}

function isVerifiedCapability(value) {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object' || Array.isArray(value)) return true;
  if (value.verified === false) return false;
  if (value.sourceRole === 'FALLBACK_UNVERIFIED' || value.sourceRole === 'UNKNOWN') return false;
  return true;
}

function capabilityCoverage(profile, input) {
  const required = profile?.requiredCapabilities || [];
  const available = [];
  const missing = [];
  const unverified = [];
  for (const key of required) {
    const value = cap(input, key);
    if (value === null || value === undefined) missing.push(key);
    else if (!isVerifiedCapability(value)) unverified.push(key);
    else available.push(key);
  }
  return {
    required,
    available,
    missing,
    unverified,
    score: round((available.length / Math.max(required.length, 1)) * 100),
    ready: missing.length === 0 && unverified.length === 0,
  };
}

function metric(input, key, fields = ['value']) {
  const value = cap(input, key);
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return finite(value);
  for (const field of fields) {
    const candidate = finite(value[field]);
    if (candidate !== null) return candidate;
  }
  return null;
}

function push(flags, condition, code, weight, state) {
  if (!condition) return;
  flags.push(code);
  state.score += weight;
}

function evaluateEtf(profile, input, coverage) {
  const expense = metric(input, 'EXPENSE_RATIO', ['valuePct', 'value']);
  const tracking = metric(input, 'TRACKING_ERROR', ['valuePct', 'value']);
  const liquidity = cap(input, 'LIQUIDITY') || {};
  const spread = finite(liquidity.bidAskSpreadPct);
  const avgDollarVolume = finite(liquidity.avgDollarVolume);
  const concentration = cap(input, 'CONCENTRATION') || {};
  const top10 = finite(concentration.top10WeightPct);
  const largest = finite(concentration.largestHoldingWeightPct);
  const holdings = cap(input, 'HOLDINGS') || {};
  const holdingCount = finite(holdings.count);
  const state = { score: 18 };
  const flags = [];
  push(flags, expense !== null && expense > 1, 'ETF_HIGH_EXPENSE_RATIO', 18, state);
  push(flags, expense !== null && expense > 0.5 && expense <= 1, 'ETF_ELEVATED_EXPENSE_RATIO', 8, state);
  push(flags, tracking !== null && tracking > 2, 'ETF_HIGH_TRACKING_ERROR', 18, state);
  push(flags, top10 !== null && top10 > 65, 'ETF_HIGH_TOP10_CONCENTRATION', 18, state);
  push(flags, largest !== null && largest > 20, 'ETF_SINGLE_HOLDING_CONCENTRATION', 12, state);
  push(flags, spread !== null && spread > 0.6, 'ETF_WIDE_BID_ASK_SPREAD', 15, state);
  push(flags, avgDollarVolume !== null && avgDollarVolume < 1_000_000, 'ETF_LOW_TRADING_LIQUIDITY', 15, state);
  push(flags, holdingCount !== null && holdingCount < 20, 'ETF_LOW_DIVERSIFICATION', 10, state);
  return {
    model: 'ETF_PORTFOLIO',
    riskScore: coverage.ready ? clamp(state.score) : null,
    riskFlags: flags,
    metrics: { expenseRatioPct: expense, trackingErrorPct: tracking, bidAskSpreadPct: spread, avgDollarVolume, top10WeightPct: top10, largestHoldingWeightPct: largest, holdingCount },
    actionPolicy: 'LONG_ONLY_FUND',
  };
}

function evaluateFund(profile, input, coverage) {
  const expense = metric(input, 'FEES', ['expenseRatioPct', 'valuePct', 'value']);
  const benchmark = cap(input, 'BENCHMARK') || {};
  const excessReturn = finite(benchmark.excessReturnPct);
  const tracking = finite(benchmark.trackingErrorPct);
  const holdings = cap(input, 'HOLDINGS') || {};
  const top10 = finite(holdings.top10WeightPct);
  const state = { score: 20 };
  const flags = [];
  push(flags, expense !== null && expense > 1.5, 'FUND_HIGH_FEES', 20, state);
  push(flags, tracking !== null && tracking > 4, 'FUND_HIGH_TRACKING_VARIANCE', 12, state);
  push(flags, top10 !== null && top10 > 70, 'FUND_HIGH_CONCENTRATION', 15, state);
  push(flags, excessReturn !== null && excessReturn < -10, 'FUND_MATERIAL_BENCHMARK_UNDERPERFORMANCE', 15, state);
  return { model: 'FUND_PORTFOLIO', riskScore: coverage.ready ? clamp(state.score) : null, riskFlags: flags, metrics: { expenseRatioPct: expense, excessReturnPct: excessReturn, trackingErrorPct: tracking, top10WeightPct: top10 }, actionPolicy: 'LONG_ONLY_FUND' };
}

const RATING_RISK = Object.freeze({ AAA: 0, AA: 4, A: 8, BBB: 14, BB: 28, B: 42, CCC: 60, CC: 70, C: 80, D: 100 });
function ratingBucket(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (raw.startsWith('AAA')) return 'AAA';
  if (raw.startsWith('AA')) return 'AA';
  if (raw.startsWith('A')) return 'A';
  if (raw.startsWith('BBB')) return 'BBB';
  if (raw.startsWith('BB')) return 'BB';
  if (raw.startsWith('B')) return 'B';
  if (raw.startsWith('CCC')) return 'CCC';
  if (raw.startsWith('CC')) return 'CC';
  if (raw.startsWith('C')) return 'C';
  if (raw.startsWith('D')) return 'D';
  return null;
}

function evaluateBond(profile, input, coverage) {
  const yieldPct = metric(input, 'YIELD', ['yieldToMaturityPct', 'valuePct', 'value']);
  const duration = metric(input, 'DURATION', ['modifiedDuration', 'value']);
  const spread = metric(input, 'SPREAD', ['spreadBps', 'value']);
  const credit = cap(input, 'CREDIT_QUALITY') || {};
  const rating = ratingBucket(credit.rating || credit.value);
  const state = { score: 15 + (rating ? RATING_RISK[rating] : 0) };
  const flags = [];
  push(flags, duration !== null && duration > 10, 'BOND_HIGH_DURATION', 18, state);
  push(flags, duration !== null && duration > 6 && duration <= 10, 'BOND_ELEVATED_DURATION', 8, state);
  push(flags, spread !== null && spread > 600, 'BOND_DISTRESSED_SPREAD', 35, state);
  push(flags, spread !== null && spread > 300 && spread <= 600, 'BOND_HIGH_CREDIT_SPREAD', 18, state);
  push(flags, rating !== null && ['BB', 'B', 'CCC', 'CC', 'C', 'D'].includes(rating), 'BOND_BELOW_INVESTMENT_GRADE', 10, state);
  return { model: 'BOND_CREDIT_DURATION', riskScore: coverage.ready ? clamp(state.score) : null, riskFlags: flags, metrics: { yieldToMaturityPct: yieldPct, modifiedDuration: duration, spreadBps: spread, rating }, actionPolicy: 'FIXED_INCOME' };
}

function evaluateCrypto(profile, input, coverage) {
  const history = cap(input, 'PRICE_HISTORY') || {};
  const vol = finite(history.annualizedVolatilityPct);
  const drawdown = finite(history.maxDrawdownPct);
  const liquidity = cap(input, 'LIQUIDITY') || {};
  const avgDollarVolume = finite(liquidity.avgDollarVolume);
  const protocol = cap(input, 'NETWORK_OR_PROTOCOL_RISK') || {};
  const protocolRisk = finite(protocol.riskScore);
  const state = { score: 35 + (protocolRisk !== null ? protocolRisk * 0.35 : 0) };
  const flags = [];
  push(flags, vol !== null && vol > 100, 'CRYPTO_EXTREME_VOLATILITY', 20, state);
  push(flags, drawdown !== null && drawdown < -60, 'CRYPTO_SEVERE_DRAWDOWN', 18, state);
  push(flags, avgDollarVolume !== null && avgDollarVolume < 5_000_000, 'CRYPTO_LOW_LIQUIDITY', 18, state);
  push(flags, protocolRisk !== null && protocolRisk >= 70, 'CRYPTO_HIGH_PROTOCOL_RISK', 20, state);
  return { model: 'CRYPTO_NETWORK_MARKET', riskScore: coverage.ready ? clamp(state.score) : null, riskFlags: flags, metrics: { annualizedVolatilityPct: vol, maxDrawdownPct: drawdown, avgDollarVolume, protocolRiskScore: protocolRisk }, actionPolicy: 'HIGH_VOLATILITY_SPOT' };
}

function evaluateFx(profile, input, coverage) {
  const history = cap(input, 'PRICE_HISTORY') || {};
  const vol = finite(history.annualizedVolatilityPct);
  const rateDiff = metric(input, 'RATE_DIFFERENTIAL', ['annualizedPct', 'valuePct', 'value']);
  const macro = cap(input, 'MACRO_RISK') || {};
  const macroRisk = finite(macro.riskScore);
  const state = { score: 25 + (macroRisk !== null ? macroRisk * 0.3 : 0) };
  const flags = [];
  push(flags, vol !== null && vol > 20, 'FX_HIGH_VOLATILITY', 20, state);
  push(flags, macroRisk !== null && macroRisk >= 70, 'FX_HIGH_MACRO_RISK', 20, state);
  return { model: 'FX_MACRO_CARRY', riskScore: coverage.ready ? clamp(state.score) : null, riskFlags: flags, metrics: { annualizedVolatilityPct: vol, annualizedRateDifferentialPct: rateDiff, macroRiskScore: macroRisk }, actionPolicy: 'FX_SPOT_OR_HEDGED' };
}

function evaluateCommodity(profile, input, coverage) {
  const curve = cap(input, 'FUTURES_CURVE') || {};
  const frontToNext = finite(curve.frontToNextPct);
  const inventories = cap(input, 'INVENTORIES') || {};
  const inventoryChange = finite(inventories.changePct);
  const vol = metric(input, 'VOLATILITY', ['annualizedVolatilityPct', 'valuePct', 'value']);
  const state = { score: 25 };
  const flags = [];
  push(flags, vol !== null && vol > 45, 'COMMODITY_HIGH_VOLATILITY', 20, state);
  push(flags, frontToNext !== null && frontToNext < -3, 'COMMODITY_STEEP_CONTANGO', 12, state);
  push(flags, inventoryChange !== null && inventoryChange > 20, 'COMMODITY_INVENTORY_BUILD', 10, state);
  return { model: 'COMMODITY_CURVE_INVENTORY', riskScore: coverage.ready ? clamp(state.score) : null, riskFlags: flags, metrics: { frontToNextPct: frontToNext, inventoryChangePct: inventoryChange, annualizedVolatilityPct: vol }, actionPolicy: 'COMMODITY_EXPOSURE' };
}

function evaluateFuture(profile, input, coverage) {
  const future = cap(input, 'FUTURES_PRICE') || {};
  const multiplier = metric(input, 'CONTRACT_MULTIPLIER');
  const margin = cap(input, 'MARGIN_RISK') || {};
  const initialMargin = finite(margin.initialMargin);
  const price = finite(future.value ?? future.price);
  const notional = price !== null && multiplier !== null ? Math.abs(price * multiplier) : null;
  const leverage = notional !== null && initialMargin !== null && initialMargin > 0 ? notional / initialMargin : null;
  const expiry = cap(input, 'EXPIRY') || {};
  const daysToExpiry = finite(expiry.daysToExpiry);
  const state = { score: 35 };
  const flags = [];
  push(flags, leverage !== null && leverage > 10, 'FUTURE_HIGH_EFFECTIVE_LEVERAGE', 30, state);
  push(flags, leverage !== null && leverage > 5 && leverage <= 10, 'FUTURE_ELEVATED_LEVERAGE', 15, state);
  push(flags, daysToExpiry !== null && daysToExpiry < 7, 'FUTURE_NEAR_EXPIRY', 15, state);
  return { model: 'FUTURE_DERIVATIVE', riskScore: coverage.ready ? clamp(state.score) : null, riskFlags: flags, metrics: { price, contractMultiplier: multiplier, notional, effectiveLeverage: round(leverage, 2), daysToExpiry }, actionPolicy: 'LEVERAGED_DERIVATIVE' };
}

function evaluateOption(profile, input, coverage) {
  const price = metric(input, 'OPTION_PRICE', ['mid', 'value', 'price']);
  const iv = metric(input, 'IMPLIED_VOLATILITY', ['valuePct', 'value']);
  const greeks = cap(input, 'GREEKS') || {};
  const liquidity = cap(input, 'LIQUIDITY') || {};
  const spread = finite(liquidity.bidAskSpreadPct);
  const openInterest = finite(liquidity.openInterest);
  const expiry = cap(input, 'EXPIRY') || {};
  const daysToExpiry = finite(expiry.daysToExpiry);
  const state = { score: 45 };
  const flags = [];
  push(flags, daysToExpiry !== null && daysToExpiry <= 7, 'OPTION_VERY_SHORT_EXPIRY', 25, state);
  push(flags, iv !== null && iv > 120, 'OPTION_EXTREME_IMPLIED_VOLATILITY', 20, state);
  push(flags, spread !== null && spread > 10, 'OPTION_VERY_WIDE_SPREAD', 20, state);
  push(flags, openInterest !== null && openInterest < 100, 'OPTION_LOW_OPEN_INTEREST', 15, state);
  return { model: 'OPTION_VOLATILITY_GREEKS', riskScore: coverage.ready ? clamp(state.score) : null, riskFlags: flags, metrics: { optionPrice: price, impliedVolatilityPct: iv, delta: finite(greeks.delta), gamma: finite(greeks.gamma), theta: finite(greeks.theta), vega: finite(greeks.vega), bidAskSpreadPct: spread, openInterest, daysToExpiry }, actionPolicy: 'NONLINEAR_DERIVATIVE' };
}

function evaluateCash(profile, input, coverage) {
  const rate = metric(input, 'YIELD_OR_RATE', ['annualizedPct', 'valuePct', 'value']);
  const liquidity = cap(input, 'LIQUIDITY') || {};
  const accessDays = finite(liquidity.accessDays);
  const state = { score: 5 };
  const flags = [];
  push(flags, accessDays !== null && accessDays > 7, 'CASH_LIMITED_LIQUIDITY', 15, state);
  return { model: 'CASH_LIQUIDITY', riskScore: coverage.ready ? clamp(state.score) : null, riskFlags: flags, metrics: { annualizedRatePct: rate, accessDays }, actionPolicy: 'CAPITAL_PRESERVATION' };
}

export function evaluateInstrumentCapabilities(profile, input = {}) {
  const coverage = capabilityCoverage(profile, input);
  const model = profile?.analysisModel || 'UNSUPPORTED_UNKNOWN';
  let evaluation = null;
  if (model === 'ETF_PORTFOLIO') evaluation = evaluateEtf(profile, input, coverage);
  else if (model === 'FUND_PORTFOLIO') evaluation = evaluateFund(profile, input, coverage);
  else if (model === 'BOND_CREDIT_DURATION') evaluation = evaluateBond(profile, input, coverage);
  else if (model === 'CRYPTO_NETWORK_MARKET') evaluation = evaluateCrypto(profile, input, coverage);
  else if (model === 'FX_MACRO_CARRY') evaluation = evaluateFx(profile, input, coverage);
  else if (model === 'COMMODITY_CURVE_INVENTORY') evaluation = evaluateCommodity(profile, input, coverage);
  else if (model === 'FUTURE_DERIVATIVE') evaluation = evaluateFuture(profile, input, coverage);
  else if (model === 'OPTION_VOLATILITY_GREEKS') evaluation = evaluateOption(profile, input, coverage);
  else if (model === 'CASH_LIQUIDITY') evaluation = evaluateCash(profile, input, coverage);

  if (!evaluation) {
    return {
      format: 'investor-control-capability-evaluation', version: 1, policyVersion: CAPABILITY_EVALUATOR_VERSION,
      instrumentId: profile?.instrumentId || null, assetClass: profile?.assetClass || 'UNKNOWN', analysisModel: model,
      status: model.startsWith('EQUITY_') ? 'DELEGATED_TO_EQUITY_ENGINE' : 'UNSUPPORTED_MODEL',
      coverage, riskScore: null, riskFlags: [], metrics: {}, actionPolicy: model.startsWith('EQUITY_') ? 'EQUITY_EXISTING_ENGINE' : null,
      decisionModelReady: model.startsWith('EQUITY_'),
    };
  }

  const leveragedDerivative = ['FUTURE_DERIVATIVE', 'OPTION_VOLATILITY_GREEKS'].includes(model);
  const strategyReady = !leveragedDerivative || isVerifiedCapability(cap(input, 'STRATEGY_CONTEXT'));
  return {
    format: 'investor-control-capability-evaluation',
    version: 1,
    policyVersion: CAPABILITY_EVALUATOR_VERSION,
    instrumentId: profile?.instrumentId || null,
    assetClass: profile?.assetClass || 'UNKNOWN',
    analysisModel: model,
    status: coverage.ready && strategyReady ? 'MODEL_READY' : 'BLOCKED_BY_CAPABILITIES',
    coverage,
    ...evaluation,
    strategyContextReady: strategyReady,
    decisionModelReady: coverage.ready && strategyReady && evaluation.riskScore !== null,
    blockers: [
      ...coverage.missing.map((key) => `CAPABILITY_REQUIRED:${key}`),
      ...coverage.unverified.map((key) => `CAPABILITY_UNVERIFIED:${key}`),
      ...(!strategyReady ? ['STRATEGY_CONTEXT_REQUIRED'] : []),
    ],
  };
}

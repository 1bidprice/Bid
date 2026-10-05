export const MINBEIS_RISK_POLICY_VERSION = '2026-10-05.1';

export const SEVERE_FUNDAMENTAL_FLAGS = new Set([
  'CASH_RUNWAY_UNDER_ONE_YEAR',
  'SEVERE_DILUTION',
  'NON_POSITIVE_EQUITY',
  'VERY_HIGH_LIABILITIES_TO_ASSETS',
  'SEVERE_NEGATIVE_NET_MARGIN',
  'BANK_CAPITAL_BELOW_REQUIREMENT',
  'BANK_HIGH_STAGE3_LOANS',
]);

export const SEVERE_MARKET_FLAGS = new Set([
  'EXTREME_VOLATILITY',
  'SEVERE_DRAWDOWN',
  'LOW_LIQUIDITY',
]);

const unique = (items) => [...new Set((Array.isArray(items) ? items : []).filter(Boolean))];

export function canonicalRiskAssessment(input = {}) {
  const fundamentalFlags = unique(input.fundamentalFlags);
  const marketFlags = unique(input.marketFlags);
  const riskScore = Number.isFinite(Number(input.riskScore)) ? Number(input.riskScore) : null;

  const severeFundamental = fundamentalFlags.filter((flag) => SEVERE_FUNDAMENTAL_FLAGS.has(flag));
  const severeMarket = marketFlags.filter((flag) => SEVERE_MARKET_FLAGS.has(flag));
  const severe = severeFundamental.length > 0 || severeMarket.length > 0 || (riskScore !== null && riskScore >= 85);

  let severity = 'LOW';
  if (severe) severity = 'SEVERE';
  else if (riskScore !== null && riskScore >= 70) severity = 'HIGH';
  else if (riskScore !== null && riskScore >= 50) severity = 'ELEVATED';
  else if (fundamentalFlags.length > 0 || marketFlags.length > 0 || (riskScore !== null && riskScore >= 30)) severity = 'MODERATE';

  return {
    policyVersion: MINBEIS_RISK_POLICY_VERSION,
    severity,
    severe,
    riskScore,
    fundamentalFlags,
    marketFlags,
    severeFundamental,
    severeMarket,
  };
}

export function finalActionRiskAssessment(finalAction = {}) {
  return canonicalRiskAssessment({
    fundamentalFlags: finalAction?.risk?.fundamentalFlags || [],
    marketFlags: finalAction?.risk?.marketFlags || [],
    riskScore: finalAction?.risk?.riskScore,
  });
}

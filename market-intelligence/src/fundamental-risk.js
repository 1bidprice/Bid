function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function latestValue(entry) {
  return finite(entry?.value);
}

function ratio(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? numerator / denominator
    : null;
}

export function assessFundamentalRisk(fundamentals, priceInput, options = {}) {
  const price = finite(priceInput);
  const revenue = latestValue(fundamentals?.annual?.revenue?.[0]);
  const netIncome = latestValue(fundamentals?.annual?.netIncome?.[0]);
  const dilutedShares = latestValue(fundamentals?.annual?.dilutedShares?.[0]);
  const cash = latestValue(fundamentals?.instant?.cash);
  const assets = latestValue(fundamentals?.instant?.assets);
  const liabilities = latestValue(fundamentals?.instant?.liabilities);
  const equity = latestValue(fundamentals?.instant?.equity);
  const freeCashFlow = finite(fundamentals?.metrics?.latestAnnualFreeCashFlowUSD);
  const dilutionPct = finite(fundamentals?.metrics?.dilutedSharesChangePct);

  const marketCap = price !== null && dilutedShares !== null ? price * dilutedShares : null;
  const priceToSales = ratio(marketCap, revenue);
  const priceToBook = ratio(marketCap, equity);
  const liabilitiesToAssets = ratio(liabilities, assets);
  const netMargin = ratio(netIncome, revenue);
  const cashRunwayYears = cash !== null && freeCashFlow !== null && freeCashFlow < 0
    ? cash / Math.abs(freeCashFlow)
    : null;

  const flags = [];
  if (freeCashFlow !== null && freeCashFlow < 0) flags.push('NEGATIVE_FREE_CASH_FLOW');
  if (cashRunwayYears !== null && cashRunwayYears < 1) flags.push('CASH_RUNWAY_UNDER_ONE_YEAR');
  else if (cashRunwayYears !== null && cashRunwayYears < 2) flags.push('CASH_RUNWAY_UNDER_TWO_YEARS');
  if (dilutionPct !== null && dilutionPct >= 20) flags.push('SEVERE_DILUTION');
  else if (dilutionPct !== null && dilutionPct >= 8) flags.push('MATERIAL_DILUTION');
  if (equity !== null && equity <= 0) flags.push('NON_POSITIVE_EQUITY');
  if (liabilitiesToAssets !== null && liabilitiesToAssets >= 0.9) flags.push('VERY_HIGH_LIABILITIES_TO_ASSETS');
  else if (liabilitiesToAssets !== null && liabilitiesToAssets >= 0.75) flags.push('HIGH_LIABILITIES_TO_ASSETS');
  if (priceToSales !== null && priceToSales >= 20) flags.push('EXTREME_PRICE_TO_SALES');
  else if (priceToSales !== null && priceToSales >= 10) flags.push('HIGH_PRICE_TO_SALES');
  if (netMargin !== null && netMargin <= -0.5) flags.push('SEVERE_NEGATIVE_NET_MARGIN');
  else if (netMargin !== null && netMargin < 0) flags.push('NEGATIVE_NET_MARGIN');

  let riskScore = 20;
  const weights = {
    NEGATIVE_FREE_CASH_FLOW: 10,
    CASH_RUNWAY_UNDER_ONE_YEAR: 25,
    CASH_RUNWAY_UNDER_TWO_YEARS: 15,
    SEVERE_DILUTION: 25,
    MATERIAL_DILUTION: 14,
    NON_POSITIVE_EQUITY: 22,
    VERY_HIGH_LIABILITIES_TO_ASSETS: 20,
    HIGH_LIABILITIES_TO_ASSETS: 12,
    EXTREME_PRICE_TO_SALES: 15,
    HIGH_PRICE_TO_SALES: 8,
    SEVERE_NEGATIVE_NET_MARGIN: 18,
    NEGATIVE_NET_MARGIN: 10,
  };
  for (const flag of flags) riskScore += weights[flag] || 0;
  riskScore = Math.min(100, riskScore);

  const coverage = [price, revenue, dilutedShares, cash, assets, liabilities, equity, freeCashFlow]
    .filter((value) => value !== null).length;
  const expected = 8;
  const metricsReady = Boolean(
    fundamentals?.metricsReady === true &&
    price !== null &&
    revenue !== null &&
    dilutedShares !== null &&
    coverage >= Number(options.minimumCoverage || 6),
  );

  return {
    format: 'investor-control-fundamental-risk',
    version: 1,
    generatedAt: new Date(options.generatedAt || Date.now()).toISOString(),
    companyId: options.companyId || fundamentals?.companyId || null,
    currency: options.currency || 'USD',
    referencePrice: price,
    coverage: {
      available: coverage,
      expected,
      score: round((coverage / expected) * 100, 2),
    },
    valuation: {
      marketCapitalization: round(marketCap, 2),
      priceToSales: round(priceToSales, 2),
      priceToBook: round(priceToBook, 2),
    },
    balanceSheet: {
      cash,
      assets,
      liabilities,
      equity,
      liabilitiesToAssetsPct: liabilitiesToAssets === null ? null : round(liabilitiesToAssets * 100, 2),
      cashRunwayYears: round(cashRunwayYears, 2),
    },
    profitability: {
      revenue,
      netIncome,
      freeCashFlow,
      netMarginPct: netMargin === null ? null : round(netMargin * 100, 2),
    },
    capitalStructure: {
      dilutedShares,
      dilutedSharesChangePct: dilutionPct,
    },
    flags,
    riskScore,
    metricsReady,
  };
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
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
  const freeCashFlow = finite(fundamentals?.metrics?.latestFreeCashFlow ?? fundamentals?.metrics?.latestAnnualFreeCashFlowUSD);
  const flowPeriodMonths = finite(fundamentals?.reporting?.periodMonths) ?? 12;
  const annualComparable = fundamentals?.reporting ? fundamentals.reporting.annualComparable === true : true;
  const dilutionPct = finite(fundamentals?.metrics?.dilutedSharesChangePct);
  const reportedCurrency = fundamentals?.reporting?.currency || fundamentals?.annual?.revenue?.[0]?.unit || fundamentals?.instant?.assets?.unit || null;
  const expectedCurrency = options.currency || reportedCurrency || 'USD';
  const currencyConsistent = !reportedCurrency || reportedCurrency === expectedCurrency;
  const model = fundamentals?.model || {
    type: 'GENERIC_OPERATING',
    genericValuationEligible: true,
    specializedModelRequired: false,
    modelReady: true,
    reasonCodes: ['LEGACY_GENERIC_DEFAULT'],
  };
  const genericModelEligible = model.genericValuationEligible !== false && model.specializedModelRequired !== true && model.modelReady !== false;
  const bankPassport = fundamentals?.specializedModels?.bank || null;
  const bankPeriodEndShares = latestValue(bankPassport?.facts?.sharesOutstanding);
  const bankWeightedAverageShares = latestValue(bankPassport?.facts?.dilutedShares) ?? dilutedShares;
  const bankSharesOutstanding = bankPeriodEndShares ?? bankWeightedAverageShares;
  const bankShareBasis = bankPeriodEndShares !== null
    ? 'PERIOD_END_OUTSTANDING'
    : bankWeightedAverageShares !== null
      ? 'DILUTED_WEIGHTED_AVERAGE_APPROXIMATION'
      : 'UNAVAILABLE';
  const bankEquity = latestValue(bankPassport?.facts?.equity) ?? equity;
  const bankMarketCap = price !== null && bankSharesOutstanding !== null ? price * bankSharesOutstanding : null;
  const bankPriceToBook = ratio(bankMarketCap, bankEquity);
  const bankRiskScore = finite(bankPassport?.riskAssessment?.score);

  const marketCap = price !== null && dilutedShares !== null ? price * dilutedShares : null;
  const priceToSales = genericModelEligible && annualComparable ? ratio(marketCap, revenue) : null;
  const priceToBook = genericModelEligible ? ratio(marketCap, equity) : null;
  const liabilitiesToAssets = ratio(liabilities, assets);
  const netMargin = genericModelEligible ? ratio(netIncome, revenue) : null;
  const netMarginComparable = netMargin !== null && Math.abs(netMargin) <= 10;
  const cashRunwayYears = genericModelEligible && annualComparable && cash !== null && freeCashFlow !== null && freeCashFlow < 0
    ? cash / Math.abs(freeCashFlow)
    : null;

  const flags = [];
  if (genericModelEligible && freeCashFlow !== null && freeCashFlow < 0) flags.push('NEGATIVE_FREE_CASH_FLOW');
  if (cashRunwayYears !== null && cashRunwayYears < 1) flags.push('CASH_RUNWAY_UNDER_ONE_YEAR');
  else if (cashRunwayYears !== null && cashRunwayYears < 2) flags.push('CASH_RUNWAY_UNDER_TWO_YEARS');
  if (dilutionPct !== null && dilutionPct >= 20) flags.push('SEVERE_DILUTION');
  else if (dilutionPct !== null && dilutionPct >= 8) flags.push('MATERIAL_DILUTION');
  if (equity !== null && equity <= 0) flags.push('NON_POSITIVE_EQUITY');
  if (genericModelEligible && liabilitiesToAssets !== null && liabilitiesToAssets >= 0.9) flags.push('VERY_HIGH_LIABILITIES_TO_ASSETS');
  else if (genericModelEligible && liabilitiesToAssets !== null && liabilitiesToAssets >= 0.75) flags.push('HIGH_LIABILITIES_TO_ASSETS');
  if (priceToSales !== null && priceToSales >= 20) flags.push('EXTREME_PRICE_TO_SALES');
  else if (priceToSales !== null && priceToSales >= 10) flags.push('HIGH_PRICE_TO_SALES');
  if (netMarginComparable && netMargin <= -0.5) flags.push('SEVERE_NEGATIVE_NET_MARGIN');
  else if (netMarginComparable && netMargin < 0) flags.push('NEGATIVE_NET_MARGIN');

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
  riskScore = genericModelEligible ? Math.min(100, riskScore) : null;

  const coverage = [price, revenue, dilutedShares, cash, assets, liabilities, equity, freeCashFlow]
    .filter((value) => value !== null).length;
  const expected = 8;
  const genericMetricsReady = Boolean(
    fundamentals?.metricsReady === true &&
    price !== null &&
    revenue !== null &&
    dilutedShares !== null &&
    coverage >= Number(options.minimumCoverage || 6) &&
    currencyConsistent &&
    genericModelEligible,
  );
  const bankMetricsReady = Boolean(
    bankPassport?.decisionReady === true &&
    fundamentals?.metricsReady === true &&
    price !== null &&
    bankSharesOutstanding !== null &&
    bankEquity !== null && bankEquity > 0 &&
    bankPriceToBook !== null &&
    bankRiskScore !== null &&
    currencyConsistent,
  );
  const metricsReady = bankPassport ? bankMetricsReady : genericMetricsReady;

  return {
    format: 'investor-control-fundamental-risk',
    version: 1,
    generatedAt: new Date(options.generatedAt || Date.now()).toISOString(),
    companyId: options.companyId || fundamentals?.companyId || null,
    currency: expectedCurrency,
    reportedCurrency,
    currencyConsistent,
    model,
    valuationModelStatus: genericModelEligible ? 'GENERIC_MODEL_READY' : bankPassport ? bankPassport.status : 'SPECIALIZED_MODEL_REQUIRED',
    specializedAnalysis: bankPassport ? {
      type: 'BANK',
      status: bankPassport.status,
      decisionReady: bankPassport.decisionReady,
      blockers: bankPassport.blockers,
      metrics: bankPassport.metrics,
      coverage: bankPassport.coverage,
      valuation: {
        marketCapitalization: round(bankMarketCap, 2),
        priceToBook: round(bankPriceToBook, 2),
        sharesOutstanding: bankSharesOutstanding,
        shareBasis: bankShareBasis,
        priceToBookApproximate: bankShareBasis === 'DILUTED_WEIGHTED_AVERAGE_APPROXIMATION',
        equity: bankEquity,
      },
      riskAssessment: bankPassport.riskAssessment || null,
      regulatoryCapital: bankPassport.regulatoryCapital || null,
      accountingPolicy: bankPassport.accountingPolicy,
    } : null,
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
      flowPeriodMonths,
      annualComparable,
      netMarginPct: netMargin === null ? null : round(netMargin * 100, 2),
      netMarginComparable,
      netMarginDisplay: netMargin === null ? null : netMarginComparable ? `${round(netMargin * 100, 2)}%` : 'Μη συγκρίσιμο λόγω πολύ χαμηλής βάσης εσόδων',
    },
    capitalStructure: {
      dilutedShares,
      dilutedSharesChangePct: dilutionPct,
    },
    flags,
    riskScore,
    riskDataStatus: metricsReady ? 'READY' : 'INSUFFICIENT_DATA',
    metricsReady,
  };
}

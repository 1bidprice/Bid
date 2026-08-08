const CONCEPTS = Object.freeze({
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
  ],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
  capitalExpenditure: ['PaymentsToAcquirePropertyPlantAndEquipment'],
  cash: [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
  ],
  assets: ['Assets'],
  liabilities: ['Liabilities'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
});

function paddedCik(cik) {
  const digits = String(cik || '').replace(/\D/g, '');
  if (!digits) throw new Error('SEC company facts adapter requires a CIK');
  return digits.padStart(10, '0');
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function conceptFromPayload(payload, aliases) {
  const namespace = payload?.facts?.['us-gaap'] || {};
  for (const alias of aliases) {
    if (namespace[alias]?.units) return { name: alias, fact: namespace[alias] };
  }
  return null;
}

function normalizedEntry(entry, conceptName, unit) {
  const value = numeric(entry?.val);
  if (value === null || !entry?.end || !entry?.filed || !entry?.accn) return null;
  return {
    concept: conceptName,
    unit,
    value,
    start: entry.start || null,
    end: entry.end,
    filed: entry.filed,
    accession: entry.accn,
    form: entry.form || null,
    fiscalYear: Number.isFinite(Number(entry.fy)) ? Number(entry.fy) : null,
    fiscalPeriod: entry.fp || null,
    frame: entry.frame || null,
  };
}

function unitEntries(concept, preferredUnits) {
  if (!concept) return [];
  for (const unit of preferredUnits) {
    const entries = concept.fact.units?.[unit];
    if (Array.isArray(entries) && entries.length) {
      return entries
        .map((entry) => normalizedEntry(entry, concept.name, unit))
        .filter(Boolean);
    }
  }
  return [];
}

function latestFiledByPeriod(entries) {
  const byEnd = new Map();
  for (const entry of entries) {
    const current = byEnd.get(entry.end);
    if (!current || String(entry.filed).localeCompare(String(current.filed)) > 0) {
      byEnd.set(entry.end, entry);
    }
  }
  return [...byEnd.values()].sort((a, b) => {
    const endOrder = String(b.end).localeCompare(String(a.end));
    return endOrder || String(b.filed).localeCompare(String(a.filed));
  });
}

function annualSeries(payload, aliases, preferredUnits) {
  const concept = conceptFromPayload(payload, aliases);
  const entries = unitEntries(concept, preferredUnits)
    .filter((entry) => ['10-K', '10-K/A', '20-F', '20-F/A'].includes(entry.form))
    .filter((entry) => entry.start && entry.end);
  return latestFiledByPeriod(entries).slice(0, 5);
}

function latestInstant(payload, aliases, preferredUnits) {
  const concept = conceptFromPayload(payload, aliases);
  const entries = unitEntries(concept, preferredUnits)
    .filter((entry) => ['10-K', '10-K/A', '10-Q', '10-Q/A', '20-F', '20-F/A', '6-K'].includes(entry.form));
  return latestFiledByPeriod(entries)[0] || null;
}

function growthPct(latest, previous) {
  if (!latest || !previous || previous.value === 0) return null;
  return round(((latest.value - previous.value) / Math.abs(previous.value)) * 100);
}

function ratioPct(numerator, denominator) {
  if (!numerator || !denominator || denominator.value === 0) return null;
  return round((numerator.value / denominator.value) * 100);
}

function metricCoverage(snapshot) {
  const keys = [
    snapshot.annual.revenue[0],
    snapshot.annual.netIncome[0],
    snapshot.annual.operatingCashFlow[0],
    snapshot.instant.cash,
    snapshot.instant.assets,
    snapshot.instant.liabilities,
  ];
  const available = keys.filter(Boolean).length;
  return {
    available,
    expected: keys.length,
    score: round((available / keys.length) * 100),
  };
}

export function buildSecFundamentalSnapshot(payload, company, options = {}) {
  const revenue = annualSeries(payload, CONCEPTS.revenue, ['USD']);
  const netIncome = annualSeries(payload, CONCEPTS.netIncome, ['USD']);
  const operatingCashFlow = annualSeries(payload, CONCEPTS.operatingCashFlow, ['USD']);
  const capitalExpenditure = annualSeries(payload, CONCEPTS.capitalExpenditure, ['USD']);
  const dilutedShares = annualSeries(payload, CONCEPTS.dilutedShares, ['shares']);

  const snapshot = {
    format: 'investor-control-sec-fundamentals',
    version: 1,
    companyId: company.companyId,
    companyName: company.displayName || company.legalName,
    cik: paddedCik(company.cik),
    generatedAt: new Date(options.generatedAt || Date.now()).toISOString(),
    sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik(company.cik)}.json`,
    annual: {
      revenue,
      netIncome,
      operatingCashFlow,
      capitalExpenditure,
      dilutedShares,
    },
    instant: {
      cash: latestInstant(payload, CONCEPTS.cash, ['USD']),
      assets: latestInstant(payload, CONCEPTS.assets, ['USD']),
      liabilities: latestInstant(payload, CONCEPTS.liabilities, ['USD']),
      equity: latestInstant(payload, CONCEPTS.equity, ['USD']),
    },
    metrics: {
      annualRevenueGrowthPct: growthPct(revenue[0], revenue[1]),
      annualNetMarginPct: ratioPct(netIncome[0], revenue[0]),
      dilutedSharesChangePct: growthPct(dilutedShares[0], dilutedShares[1]),
      latestAnnualFreeCashFlowUSD:
        operatingCashFlow[0] && capitalExpenditure[0]
          ? operatingCashFlow[0].value - capitalExpenditure[0].value
          : null,
    },
  };

  snapshot.coverage = metricCoverage(snapshot);
  snapshot.metricsReady = snapshot.coverage.score >= 65 && Boolean(revenue[0] || operatingCashFlow[0]);
  return snapshot;
}

export async function fetchSecCompanyFacts(company, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('SEC company facts adapter requires fetch');

  const userAgent = String(options.userAgent || '').trim();
  if (!userAgent) {
    return {
      snapshot: null,
      diagnostics: [{ code: 'SEC_USER_AGENT_MISSING', companyId: company.companyId }],
    };
  }

  const cik = paddedCik(company.cik);
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': userAgent,
    },
  });

  if (!response.ok) throw new Error(`SEC company facts request failed: ${response.status}`);
  const payload = await response.json();
  const snapshot = buildSecFundamentalSnapshot(payload, company, {
    generatedAt: options.generatedAt,
  });

  return {
    snapshot,
    diagnostics: snapshot.coverage.available
      ? []
      : [{ code: 'SEC_COMPANY_FACTS_EMPTY', companyId: company.companyId }],
  };
}

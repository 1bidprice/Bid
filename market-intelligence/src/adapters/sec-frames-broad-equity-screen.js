export const SEC_FRAMES_BROAD_SCREEN_VERSION = '2026-08-09.2';

const SEC_TICKERS_EXCHANGE_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
const SEC_FRAMES_BASE = 'https://data.sec.gov/api/xbrl/frames';

const CONCEPTS = Object.freeze({
  revenue: [
    { taxonomy: 'us-gaap', concept: 'RevenueFromContractWithCustomerExcludingAssessedTax', unit: 'USD' },
    { taxonomy: 'us-gaap', concept: 'Revenues', unit: 'USD' },
    { taxonomy: 'us-gaap', concept: 'SalesRevenueNet', unit: 'USD' },
  ],
  netIncome: [
    { taxonomy: 'us-gaap', concept: 'NetIncomeLoss', unit: 'USD' },
    { taxonomy: 'us-gaap', concept: 'ProfitLoss', unit: 'USD' },
  ],
  assets: [{ taxonomy: 'us-gaap', concept: 'Assets', unit: 'USD', instant: true }],
  liabilities: [{ taxonomy: 'us-gaap', concept: 'Liabilities', unit: 'USD', instant: true }],
  equity: [
    { taxonomy: 'us-gaap', concept: 'StockholdersEquity', unit: 'USD', instant: true },
    { taxonomy: 'us-gaap', concept: 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', unit: 'USD', instant: true },
  ],
  shares: [
    { taxonomy: 'dei', concept: 'EntityCommonStockSharesOutstanding', unit: 'shares', instant: true },
  ],
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function previousCompletedQuarter(nowInput = new Date()) {
  const now = new Date(nowInput);
  const currentQuarter = Math.floor(now.getUTCMonth() / 3) + 1;
  let year = now.getUTCFullYear();
  let quarter = currentQuarter - 1;
  if (quarter === 0) {
    quarter = 4;
    year -= 1;
  }
  return { year, quarter };
}

function frameCode(period, instant = false) {
  if (!Number.isFinite(Number(period?.quarter))) return `CY${period.year}`;
  return `CY${period.year}Q${period.quarter}${instant ? 'I' : ''}`;
}

function sameQuarterPriorYear(period) {
  return { year: period.year - 1, quarter: period.quarter };
}

function previousCalendarYear(period) {
  return { year: period.year - 1, quarter: null };
}

function parseTickerExchange(payload) {
  const fields = Array.isArray(payload?.fields) ? payload.fields : [];
  const index = Object.fromEntries(fields.map((field, i) => [field, i]));
  if (![index.cik, index.ticker, index.exchange].every(Number.isInteger)) return [];
  return (payload.data || []).map((row) => ({
    cik: Number(row[index.cik]),
    name: String(row[index.name] || ''),
    ticker: String(row[index.ticker] || '').toUpperCase(),
    exchange: String(row[index.exchange] || ''),
  })).filter((item) => item.cik && item.ticker);
}

function exchangeMatches(instrument, secExchange) {
  const mic = String(instrument?.primaryListing?.mic || '').toUpperCase();
  const exchange = String(secExchange || '').toLowerCase();
  if (mic === 'XNAS') return exchange === 'nasdaq';
  if (mic === 'XNYS') return exchange === 'nyse';
  if (mic === 'XASE') return exchange.includes('nyse american') || exchange.includes('american');
  return false;
}

function buildIdentityMap(instruments, tickerRows) {
  const byTicker = new Map();
  for (const row of tickerRows) {
    const list = byTicker.get(row.ticker) || [];
    list.push(row);
    byTicker.set(row.ticker, list);
  }
  const map = new Map();
  for (const instrument of instruments) {
    if (instrument.assetClass !== 'EQUITY') continue;
    const symbol = String(instrument.primaryListing?.symbol || '').toUpperCase();
    const candidates = byTicker.get(symbol) || [];
    const match = candidates.find((row) => exchangeMatches(instrument, row.exchange)) || (candidates.length === 1 ? candidates[0] : null);
    if (match) map.set(match.cik, { instrument, sec: match });
  }
  return map;
}

function frameRows(payload) {
  return Array.isArray(payload?.data) ? payload.data : [];
}

function mergeConcept(target, identityMap, payload, key, priority) {
  for (const row of frameRows(payload)) {
    const cik = Number(row.cik);
    const identity = identityMap.get(cik);
    const value = finite(row.val);
    if (!identity || value === null) continue;
    const instrumentId = identity.instrument.instrumentId;
    const current = target.get(instrumentId) || { instrument: identity.instrument, cik, companyName: identity.sec.name, facts: {}, provenance: {} };
    if (current.facts[key] === undefined || priority < current.provenance[key]?.priority) {
      current.facts[key] = value;
      current.provenance[key] = {
        sourceRole: 'SEC_XBRL_FRAME',
        concept: payload?.tag || null,
        taxonomy: payload?.taxonomy || null,
        unit: payload?.uom || null,
        frame: payload?.ccp || null,
        accession: row.accn || null,
        filed: row.filed || null,
        priority,
      };
    }
    target.set(instrumentId, current);
  }
}

async function fetchJson(fetchImpl, url, userAgent) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': userAgent } });
  if (!response.ok) return null;
  return response.json();
}

async function fetchConceptAliases(fetchImpl, userAgent, definitions, period, diagnostics, key, suffix = '') {
  const results = [];
  for (let priority = 0; priority < definitions.length; priority += 1) {
    const def = definitions[priority];
    const frame = frameCode(period, def.instant === true);
    const url = `${SEC_FRAMES_BASE}/${def.taxonomy}/${def.concept}/${def.unit}/${frame}.json`;
    const payload = await fetchJson(fetchImpl, url, userAgent);
    if (!payload) {
      diagnostics.push({ code: 'SEC_FRAME_UNAVAILABLE', metric: `${key}${suffix}`, concept: def.concept, frame });
      continue;
    }
    results.push({ payload, priority, metric: `${key}${suffix}` });
  }
  return results;
}

function pctChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function ratioPct(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

function preliminaryRisk(signals) {
  let score = 25;
  const flags = [];
  if (signals.equity !== null && signals.equity <= 0) { score += 35; flags.push('NON_POSITIVE_EQUITY'); }
  if (signals.liabilitiesToAssetsPct !== null && signals.liabilitiesToAssetsPct >= 90) { score += 25; flags.push('VERY_HIGH_LIABILITIES_TO_ASSETS'); }
  else if (signals.liabilitiesToAssetsPct !== null && signals.liabilitiesToAssetsPct >= 75) { score += 15; flags.push('HIGH_LIABILITIES_TO_ASSETS'); }
  if (signals.netMarginPct !== null && signals.netMarginPct <= -25) { score += 20; flags.push('SEVERE_NEGATIVE_NET_MARGIN'); }
  else if (signals.netMarginPct !== null && signals.netMarginPct < 0) { score += 10; flags.push('NEGATIVE_NET_MARGIN'); }
  if (signals.revenueGrowthPct !== null && signals.revenueGrowthPct <= -30) { score += 12; flags.push('SEVERE_REVENUE_CONTRACTION'); }
  return { riskScore: Math.min(100, score), flags };
}

function qualityGrowthHealthScore(signals) {
  let score = 50;
  let components = 0;
  if (signals.netMarginPct !== null) {
    score += Math.max(-25, Math.min(25, signals.netMarginPct * 0.8));
    components += 1;
  }
  if (signals.revenueGrowthPct !== null) {
    score += Math.max(-20, Math.min(20, signals.revenueGrowthPct * 0.5));
    components += 1;
  }
  if (signals.liabilitiesToAssetsPct !== null) {
    score += Math.max(-20, Math.min(15, (60 - signals.liabilitiesToAssetsPct) * 0.5));
    components += 1;
  }
  if (signals.equity !== null && signals.equity <= 0) score = Math.min(score, 15);
  return components >= 2 ? Math.max(0, Math.min(100, score)) : null;
}

export async function buildSecFramesBroadEquityScreen(instruments = [], options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const userAgent = String(options.userAgent || '').trim();
  if (typeof fetchImpl !== 'function') throw new Error('SEC frames broad screen requires fetch');
  if (!userAgent) return { candidates: [], diagnostics: [{ code: 'SEC_USER_AGENT_MISSING' }] };

  const generatedAt = new Date(options.now || Date.now()).toISOString();
  const currentPeriod = options.period || previousCompletedQuarter(generatedAt);
  const previousPeriod = sameQuarterPriorYear(currentPeriod);
  const annualPeriod = previousCalendarYear(currentPeriod);
  const diagnostics = [];
  const tickerPayload = await fetchJson(fetchImpl, SEC_TICKERS_EXCHANGE_URL, userAgent);
  if (!tickerPayload) return { candidates: [], diagnostics: [{ code: 'SEC_TICKER_EXCHANGE_UNAVAILABLE' }] };
  const identityMap = buildIdentityMap(instruments, parseTickerExchange(tickerPayload));
  const merged = new Map();

  const currentRevenue = await fetchConceptAliases(fetchImpl, userAgent, CONCEPTS.revenue, currentPeriod, diagnostics, 'revenueCurrent');
  const priorRevenue = await fetchConceptAliases(fetchImpl, userAgent, CONCEPTS.revenue, previousPeriod, diagnostics, 'revenuePrior');
  const annualRevenue = await fetchConceptAliases(fetchImpl, userAgent, CONCEPTS.revenue, annualPeriod, diagnostics, 'annualRevenue');
  const netIncome = await fetchConceptAliases(fetchImpl, userAgent, CONCEPTS.netIncome, currentPeriod, diagnostics, 'netIncomeCurrent');
  const assets = await fetchConceptAliases(fetchImpl, userAgent, CONCEPTS.assets, currentPeriod, diagnostics, 'assets');
  const liabilities = await fetchConceptAliases(fetchImpl, userAgent, CONCEPTS.liabilities, currentPeriod, diagnostics, 'liabilities');
  const equity = await fetchConceptAliases(fetchImpl, userAgent, CONCEPTS.equity, currentPeriod, diagnostics, 'equity');
  const shares = await fetchConceptAliases(fetchImpl, userAgent, CONCEPTS.shares, currentPeriod, diagnostics, 'sharesOutstanding');

  for (const result of [...currentRevenue, ...priorRevenue, ...annualRevenue, ...netIncome, ...assets, ...liabilities, ...equity, ...shares]) {
    mergeConcept(merged, identityMap, result.payload, result.metric, result.priority);
  }

  const candidates = [];
  for (const entry of merged.values()) {
    const facts = entry.facts;
    const signals = {
      revenueCurrent: finite(facts.revenueCurrent),
      revenuePrior: finite(facts.revenuePrior),
      revenueGrowthPct: pctChange(finite(facts.revenueCurrent), finite(facts.revenuePrior)),
      annualRevenue: finite(facts.annualRevenue),
      netIncomeCurrent: finite(facts.netIncomeCurrent),
      netMarginPct: ratioPct(finite(facts.netIncomeCurrent), finite(facts.revenueCurrent)),
      assets: finite(facts.assets),
      liabilities: finite(facts.liabilities),
      equity: finite(facts.equity),
      sharesOutstanding: finite(facts.sharesOutstanding),
      liabilitiesToAssetsPct: ratioPct(finite(facts.liabilities), finite(facts.assets)),
    };
    const prelim = preliminaryRisk(signals);
    const screenScore = qualityGrowthHealthScore(signals);
    if (screenScore === null) continue;
    candidates.push({
      instrumentId: entry.instrument.instrumentId,
      companyId: `sec-cik:${entry.cik}`,
      cik: String(entry.cik),
      displayName: entry.instrument.displayName || entry.companyName,
      assetClass: 'EQUITY',
      country: 'US',
      currency: 'USD',
      primaryListing: entry.instrument.primaryListing,
      broadScreen: {
        policyVersion: SEC_FRAMES_BROAD_SCREEN_VERSION,
        score: Number(screenScore.toFixed(2)),
        rawSignals: signals,
        preliminaryRiskScore: prelim.riskScore,
        riskFlags: prelim.flags,
        period: currentPeriod,
        comparisonPeriod: previousPeriod,
        annualValuationPeriod: annualPeriod,
        provenance: entry.provenance,
        finalActionEligible: false,
      },
      cikSource: 'SEC_COMPANY_TICKERS_EXCHANGE',
    });
  }

  candidates.sort((a, b) => b.broadScreen.score - a.broadScreen.score || a.primaryListing.symbol.localeCompare(b.primaryListing.symbol));
  const limit = Math.max(1, Number(options.limit || candidates.length || 1));
  return {
    format: 'investor-control-sec-frames-broad-equity-screen',
    version: 1,
    policyVersion: SEC_FRAMES_BROAD_SCREEN_VERSION,
    generatedAt,
    period: currentPeriod,
    comparisonPeriod: previousPeriod,
    annualValuationPeriod: annualPeriod,
    universeInstrumentCount: instruments.length,
    secIdentityMatchCount: identityMap.size,
    scorableCount: candidates.length,
    candidates: candidates.slice(0, limit),
    truncated: candidates.length > limit,
    diagnostics,
    invariant: 'BROAD_SCREEN_IS_RESEARCH_PRIORITIZATION_ONLY_NEVER_A_FINAL_ACTION',
  };
}

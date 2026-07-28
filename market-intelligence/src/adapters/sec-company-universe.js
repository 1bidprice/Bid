const DEFAULT_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
const SUPPORTED_EXCHANGES = new Set(['NYSE', 'Nasdaq', 'Nasdaq Global Market', 'Nasdaq Capital Market', 'NYSE American']);

function normalizedCik(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? digits.padStart(10, '0') : null;
}

function companyId(cik) {
  return `company:sec:${cik}`;
}

function normalizeExchange(value) {
  const exchange = String(value || '').trim();
  if (/nasdaq/i.test(exchange)) return 'Nasdaq';
  if (/nyse american/i.test(exchange)) return 'NYSE American';
  if (/nyse/i.test(exchange)) return 'NYSE';
  return exchange || null;
}

function parseRows(payload) {
  if (Array.isArray(payload?.data) && Array.isArray(payload?.fields)) {
    return payload.data.map((row) => Object.fromEntries(payload.fields.map((field, index) => [field, row[index]])));
  }
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') return Object.values(payload);
  return [];
}

export function normalizeSecCompanyUniverse(payload, options = {}) {
  const allowed = new Set(options.exchanges || SUPPORTED_EXCHANGES);
  const seen = new Set();
  const companies = [];
  const rejected = [];

  for (const row of parseRows(payload)) {
    const cik = normalizedCik(row.cik ?? row.cik_str ?? row.cikNumber);
    const legalName = String(row.name ?? row.title ?? '').trim();
    const symbol = String(row.ticker ?? row.symbol ?? '').trim().toUpperCase();
    const exchange = normalizeExchange(row.exchange);
    if (!cik || !legalName || !symbol) {
      rejected.push({ code: 'SEC_UNIVERSE_ROW_INCOMPLETE', cik, legalName: legalName || null, symbol: symbol || null });
      continue;
    }
    if (exchange && allowed.size && ![...allowed].some((value) => normalizeExchange(value) === exchange)) {
      rejected.push({ code: 'SEC_UNIVERSE_EXCHANGE_EXCLUDED', cik, symbol, exchange });
      continue;
    }
    const key = `${cik}:${symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    companies.push({
      companyId: companyId(cik),
      legalName,
      displayName: legalName.replace(/\s+(inc\.?|corp\.?|corporation|plc|ltd\.?)$/i, '').trim(),
      aliases: [symbol, legalName],
      primaryListing: {
        exchange: exchange || 'US listed market',
        symbol,
        mic: exchange === 'NYSE' || exchange === 'NYSE American' ? 'XNYS' : 'XNAS',
      },
      listings: [{
        exchange: exchange || 'US listed market',
        symbol,
        mic: exchange === 'NYSE' || exchange === 'NYSE American' ? 'XNYS' : 'XNAS',
        currency: 'USD',
        active: true,
      }],
      isin: null,
      cik,
      lei: null,
      country: 'US',
      currency: 'USD',
      sector: null,
      industry: null,
      website: null,
      investorRelationsUrl: null,
      parentCompanyIds: [],
      subsidiaryCompanyIds: [],
      competitorCompanyIds: [],
      relationshipEdges: [],
      active: true,
      discoveryEligible: true,
      updatedAt: new Date(options.generatedAt || Date.now()).toISOString(),
    });
  }

  return { companies, rejected };
}

export async function fetchSecCompanyUniverse(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('SEC company universe adapter requires fetch');
  const userAgent = String(options.userAgent || '').trim();
  if (!userAgent) {
    return { companies: [], diagnostics: [{ code: 'SEC_USER_AGENT_MISSING', adapter: 'sec-company-universe' }] };
  }
  const response = await fetchImpl(options.url || DEFAULT_URL, {
    headers: { Accept: 'application/json', 'User-Agent': userAgent },
  });
  if (!response.ok) {
    return { companies: [], diagnostics: [{ code: 'SEC_COMPANY_UNIVERSE_HTTP_ERROR', status: response.status }] };
  }
  const payload = await response.json();
  const normalized = normalizeSecCompanyUniverse(payload, options);
  return {
    companies: normalized.companies,
    diagnostics: normalized.rejected.slice(0, 50),
    sourceUrl: options.url || DEFAULT_URL,
  };
}

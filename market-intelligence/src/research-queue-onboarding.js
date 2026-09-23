import { fetchSecCompanyUniverse } from './adapters/sec-company-universe.js';

function cleanRecord(record) {
  const symbol = String(record?.symbol || '').trim().toUpperCase();
  const match = symbol.match(/^([A-Z0-9][A-Z0-9.-]{0,19})\.(US|GR)$/);
  if (!match) return null;
  return {
    symbol,
    baseSymbol: match[1],
    market: match[2],
    status: String(record?.status || 'QUEUED').toUpperCase(),
    firstRequestedAt: record?.firstRequestedAt || null,
    lastRequestedAt: record?.lastRequestedAt || null,
  };
}

export function normalizeQueuedResearchRecords(input) {
  const rows = Array.isArray(input) ? input : Array.isArray(input?.records) ? input.records : [];
  const dedupe = new Map();
  for (const raw of rows) {
    const record = cleanRecord(raw);
    if (!record || record.status !== 'QUEUED') continue;
    const current = dedupe.get(record.symbol);
    if (!current || String(record.lastRequestedAt || '') > String(current.lastRequestedAt || '')) dedupe.set(record.symbol, record);
  }
  return [...dedupe.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function listingsForSymbol(company, symbol) {
  return (Array.isArray(company?.listings) ? company.listings : [])
    .filter((listing) => String(listing?.symbol || '').trim().toUpperCase() === symbol);
}

export async function resolveQueuedResearchUniverse(input, options = {}) {
  const records = normalizeQueuedResearchRecords(input);
  const generatedAt = new Date(options.generatedAt || Date.now()).toISOString();
  const diagnostics = [];
  const companies = [];
  const results = [];

  const usRecords = records.filter((record) => record.market === 'US');
  let secUniverse = { companies: [], diagnostics: [] };
  if (usRecords.length) {
    secUniverse = await fetchSecCompanyUniverse({
      fetchImpl: options.fetchImpl || globalThis.fetch,
      userAgent: options.secUserAgent || '',
      generatedAt,
    });
    diagnostics.push(...(secUniverse.diagnostics || []).map((item) => ({ ...item, source: 'SEC_QUEUE_IDENTITY' })));
  }

  for (const record of records) {
    if (record.market !== 'US') {
      results.push({
        symbol: record.symbol,
        status: 'BLOCKED',
        code: 'DYNAMIC_QUEUE_MARKET_IDENTITY_NOT_SUPPORTED',
        message: 'Dynamic queue identity onboarding is currently canonical only for US SEC-listed equities.',
      });
      continue;
    }

    const matches = (secUniverse.companies || []).flatMap((company) => {
      const listings = listingsForSymbol(company, record.baseSymbol);
      return listings.map((listing) => ({ company, listing }));
    });

    if (matches.length !== 1) {
      results.push({
        symbol: record.symbol,
        status: 'BLOCKED',
        code: matches.length ? 'QUEUE_IDENTITY_AMBIGUOUS' : 'QUEUE_IDENTITY_NOT_FOUND',
        matchCount: matches.length,
      });
      continue;
    }

    const { company, listing } = matches[0];
    const queuedCompany = {
      ...company,
      primaryListing: { ...listing },
      aliases: [...new Set([...(company.aliases || []), record.baseSymbol])],
      researchQueue: {
        source: 'MINBEIS_PERSISTENT_RESEARCH_QUEUE',
        requestedSymbol: record.symbol,
        firstRequestedAt: record.firstRequestedAt,
        lastRequestedAt: record.lastRequestedAt,
        resolvedAt: generatedAt,
      },
    };
    companies.push(queuedCompany);
    results.push({
      symbol: record.symbol,
      status: 'RESOLVED',
      companyId: company.companyId,
      cik: company.cik,
      listing: queuedCompany.primaryListing,
    });
  }

  return {
    format: 'minbeis-research-queue-resolution',
    version: 1,
    generatedAt,
    requestedCount: records.length,
    resolvedCount: companies.length,
    blockedCount: results.filter((item) => item.status === 'BLOCKED').length,
    companies,
    results,
    diagnostics,
    decisionImpact: 'FOCUS_UNIVERSE_ONLY',
  };
}

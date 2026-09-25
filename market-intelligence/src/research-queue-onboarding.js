import { fetchSecCompanyUniverse } from './adapters/sec-company-universe.js';
import { fetchAthensCompaniesBySymbols } from './adapters/euronext-athens-discovery.js';

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
    // COMPLETED is a durable research enrollment, not a tombstone. Keeping it
    // here ensures a newly onboarded instrument remains in the canonical focus
    // universe after trusted queue completion.
    if (!record || !['QUEUED', 'COMPLETED'].includes(record.status)) continue;
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
  const grRecords = records.filter((record) => record.market === 'GR');
  let secUniverse = { companies: [], diagnostics: [] };
  let athensResolution = { companies: [], results: [], diagnostics: [] };
  if (usRecords.length) {
    secUniverse = await fetchSecCompanyUniverse({
      fetchImpl: options.fetchImpl || globalThis.fetch,
      userAgent: options.secUserAgent || '',
      generatedAt,
    });
    diagnostics.push(...(secUniverse.diagnostics || []).map((item) => ({ ...item, source: 'SEC_QUEUE_IDENTITY' })));
  }
  if (grRecords.length) {
    athensResolution = await fetchAthensCompaniesBySymbols(
      grRecords.map((record) => record.baseSymbol),
      {
        fetchImpl: options.fetchImpl || globalThis.fetch,
        generatedAt,
        userAgent: options.athensUserAgent || 'MINBEIS-Market-Intelligence/1.8',
      },
    );
    diagnostics.push(...(athensResolution.diagnostics || []).map((item) => ({ ...item, source: 'EURONEXT_ATHENS_QUEUE_IDENTITY' })));
  }

  for (const record of records) {
    if (record.market === 'GR') {
      const match = (athensResolution.companies || [])
        .find((company) => String(company?.primaryListing?.symbol || '').trim().toUpperCase() === record.baseSymbol);
      const result = (athensResolution.results || [])
        .find((item) => String(item?.symbol || '').trim().toUpperCase() === record.baseSymbol);

      if (!match || result?.status !== 'RESOLVED') {
        results.push({
          symbol: record.symbol,
          status: 'BLOCKED',
          code: result?.code || 'ATHENS_QUEUE_IDENTITY_NOT_FOUND',
          matchCount: result?.matchCount ?? 0,
        });
        continue;
      }

      const queuedCompany = {
        ...match,
        researchQueue: {
          source: 'MINBEIS_PERSISTENT_RESEARCH_QUEUE',
          requestedSymbol: record.symbol,
          status: record.status,
          firstRequestedAt: record.firstRequestedAt,
          lastRequestedAt: record.lastRequestedAt,
          resolvedAt: generatedAt,
        },
      };
      companies.push(queuedCompany);
      results.push({
        symbol: record.symbol,
        status: 'RESOLVED',
        companyId: queuedCompany.companyId,
        issuerId: queuedCompany.issuerId || null,
        isin: queuedCompany.isin || null,
        listing: queuedCompany.primaryListing,
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
        status: record.status,
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
    queuedCount: records.filter((record) => record.status === 'QUEUED').length,
    completedEnrollmentCount: records.filter((record) => record.status === 'COMPLETED').length,
    resolvedCount: companies.length,
    blockedCount: results.filter((item) => item.status === 'BLOCKED').length,
    companies,
    results,
    diagnostics,
    decisionImpact: 'FOCUS_UNIVERSE_ONLY',
  };
}

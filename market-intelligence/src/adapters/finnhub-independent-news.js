import { contentHash } from '../content-hash.js';
import { reviewTrustedNewsRecords } from '../trusted-news-review.js';
import { evaluateSourceCandidate } from '../source-governor.js';

export const FINNHUB_INDEPENDENT_NEWS_VERSION = '2026-08-08.1';

function isoDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function companySymbol(company) {
  return company?.marketData?.finnhubSymbol || company?.primaryListing?.symbol || null;
}

function companyAliases(company) {
  return [company?.legalName, company?.displayName, company?.primaryListing?.symbol, ...(company?.aliases || [])]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .filter((value) => value.length >= 3);
}

function companyMatch(item, company) {
  const haystack = `${item?.headline || ''} ${item?.summary || ''} ${item?.related || ''}`.toLowerCase();
  return companyAliases(company).some((alias) => haystack.includes(alias));
}

function publishedAt(seconds, fallback) {
  const numeric = Number(seconds);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric * 1000).toISOString();
  return new Date(fallback).toISOString();
}

function normalizedRecord(item, company, retrievedAt) {
  const url = String(item?.url || '').trim();
  const sourceName = String(item?.source || '').trim();
  const sourcePolicy = evaluateSourceCandidate({
    url,
    sourceName,
    purpose: 'INDEPENDENT_CORROBORATION',
    market: company?.primaryListing?.mic || company?.country,
  });
  if (!sourcePolicy.allowed || sourcePolicy.sourceRole !== 'SECONDARY_INDEPENDENT') return null;
  if (!companyMatch(item, company)) return null;

  const publication = publishedAt(item?.datetime, retrievedAt);
  const hash = contentHash({ url, publication, headline: item?.headline || '', sourceName });
  return {
    id: `evidence:finnhub-news:${hash.slice(0, 24)}`,
    sourceType: 'FINANCIAL_NEWS',
    sourceName: sourceName || sourcePolicy.host,
    sourceUrl: url,
    sourceDocumentId: item?.id != null ? String(item.id) : null,
    publishedAt: publication,
    retrievedAt,
    eventAt: publication,
    title: String(item?.headline || '').trim(),
    rawText: String(item?.summary || '').trim() || null,
    contentHash: hash,
    language: 'en',
    companyIds: [company.companyId],
    claimType: 'ESTIMATE',
    reliabilityTier: Number(sourcePolicy.tier || 3),
    isPrimarySource: false,
    independenceGroup: `publisher:${sourcePolicy.ruleId?.replace(/^publisher:/, '') || sourcePolicy.host}`,
    supportsClaimIds: [],
    contradictsClaimIds: [],
    expiresAt: new Date(new Date(publication).getTime() + 14 * 86_400_000).toISOString(),
    notes: 'Direct publisher URL discovered through Finnhub. Recommendation-grade use still requires successful direct article review.',
    discoveryProvider: 'FINNHUB_COMPANY_NEWS',
    discoveryProviderVersion: FINNHUB_INDEPENDENT_NEWS_VERSION,
  };
}

export function normalizeFinnhubIndependentNews(payload, company, options = {}) {
  const retrievedAt = new Date(options.retrievedAt || Date.now()).toISOString();
  const items = Array.isArray(payload) ? payload : [];
  const records = [];
  const rejected = [];
  for (const item of items) {
    const record = normalizedRecord(item, company, retrievedAt);
    if (record) records.push(record);
    else rejected.push({
      code: 'FINNHUB_NEWS_ITEM_NOT_CORROBORATION_ELIGIBLE',
      sourceName: item?.source || null,
      url: item?.url || null,
      headline: item?.headline || null,
    });
  }
  return { records, rejected };
}

export async function fetchFinnhubIndependentNews(company, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const token = String(options.token || '').trim();
  const symbol = companySymbol(company);
  const retrievedAt = new Date(options.retrievedAt || Date.now()).toISOString();
  if (typeof fetchImpl !== 'function') throw new Error('Finnhub independent news requires fetch');
  if (!token) return { records: [], diagnostics: [{ code: 'FINNHUB_NEWS_TOKEN_MISSING', companyId: company?.companyId }] };
  if (!symbol) return { records: [], diagnostics: [{ code: 'FINNHUB_NEWS_SYMBOL_MISSING', companyId: company?.companyId }] };

  const to = options.to || isoDay(retrievedAt);
  const from = options.from || isoDay(new Date(new Date(`${to}T23:59:59.999Z`).getTime() - Number(options.lookbackDays || 21) * 86_400_000));
  const endpoint = new URL('https://finnhub.io/api/v1/company-news');
  endpoint.searchParams.set('symbol', symbol);
  endpoint.searchParams.set('from', from);
  endpoint.searchParams.set('to', to);

  let response;
  try {
    response = await fetchImpl(endpoint.toString(), {
      headers: { 'X-Finnhub-Token': token, Accept: 'application/json' },
    });
  } catch (error) {
    return { records: [], diagnostics: [{ code: 'FINNHUB_NEWS_FETCH_FAILED', companyId: company.companyId, message: String(error?.message || error) }] };
  }
  if (!response.ok) return { records: [], diagnostics: [{ code: 'FINNHUB_NEWS_HTTP_ERROR', companyId: company.companyId, status: response.status }] };

  const payload = await response.json();
  const normalized = normalizeFinnhubIndependentNews(payload, company, { retrievedAt });
  let records = normalized.records.slice(0, Math.max(0, Number(options.limit ?? 12)));
  const diagnostics = normalized.rejected.slice(0, 20);

  if (options.review !== false && records.length) {
    const reviewed = await reviewTrustedNewsRecords(records, company, {
      fetchImpl,
      reviewedAt: retrievedAt,
      limit: options.reviewLimit ?? 4,
      userAgent: options.userAgent || 'Investor-Control-Market-Intelligence/1.5',
      maxBytes: options.reviewMaxBytes,
      minText: options.reviewMinText,
      maxRetained: options.reviewMaxRetained,
    });
    records = reviewed.records;
    diagnostics.push(...(reviewed.diagnostics || []));
  }

  return {
    records,
    diagnostics: [
      ...diagnostics,
      ...(records.length ? [] : [{ code: 'FINNHUB_NO_ALLOWLISTED_DIRECT_NEWS', companyId: company.companyId, symbol }]),
    ],
  };
}

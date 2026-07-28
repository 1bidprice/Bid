import { contentHash } from '../content-hash.js';
import { reviewTrustedNewsRecords } from '../trusted-news-review.js';
import { independentPublisherPolicies } from '../source-policy.js';

const DEFAULT_PUBLISHERS = Object.freeze(independentPublisherPolicies());

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function plainText(value) {
  return decodeXml(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagValue(block, tag) {
  const match = String(block || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]).trim() : null;
}

function sourceValue(block) {
  const match = String(block || '').match(/<source(?:\s[^>]*)?>([\s\S]*?)<\/source>/i);
  return match ? plainText(match[1]) : null;
}

function normalizedPublisher(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^the\s+/, 'the ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function publisherPolicy(sourceName, policies = DEFAULT_PUBLISHERS) {
  const normalized = normalizedPublisher(sourceName);
  if (policies[normalized]) return policies[normalized];
  for (const [key, policy] of Object.entries(policies)) {
    if (normalized === key || normalized.includes(key) || key.includes(normalized)) return policy;
  }
  return null;
}

function companyAliases(company) {
  return [
    company?.legalName,
    company?.displayName,
    company?.primaryListing?.symbol,
    ...(company?.aliases || []),
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .filter((value) => value.length >= 3);
}

function companyMatches(text, company) {
  const normalized = String(text || '').toLowerCase();
  return companyAliases(company).some((alias) => normalized.includes(alias));
}

function publishedAt(value, fallback) {
  const parsed = new Date(value || fallback);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback).toISOString() : parsed.toISOString();
}

export function extractTrustedNewsEvidence(xml, company, options = {}) {
  const retrievedAt = new Date(options.retrievedAt || Date.now()).toISOString();
  const policies = options.publishers || DEFAULT_PUBLISHERS;
  const maxItems = Math.max(0, Number(options.limit ?? 20));
  const expiryDays = Math.max(1, Number(options.expiryDays ?? 14));
  const blocks = String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const records = [];
  const rejected = [];

  for (const block of blocks) {
    if (records.length >= maxItems) break;
    const title = plainText(tagValue(block, 'title'));
    const description = plainText(tagValue(block, 'description'));
    const sourceName = sourceValue(block) || title.split(' - ').at(-1)?.trim() || '';
    const policy = publisherPolicy(sourceName, policies);
    const link = plainText(tagValue(block, 'link'));
    const combined = `${title} ${description}`.trim();

    if (!policy) {
      rejected.push({ code: 'PUBLISHER_NOT_ALLOWLISTED', sourceName: sourceName || null, title });
      continue;
    }
    if (!link || !companyMatches(combined, company)) {
      rejected.push({ code: link ? 'COMPANY_ALIAS_NOT_FOUND' : 'NEWS_LINK_MISSING', sourceName, title });
      continue;
    }

    const publication = publishedAt(tagValue(block, 'pubDate'), retrievedAt);
    const expiresAt = new Date(new Date(publication).getTime() + expiryDays * 86_400_000).toISOString();
    const hash = contentHash({
      publisher: policy.name,
      title,
      description,
      publishedAt: publication,
    });

    records.push({
      id: `evidence:news:${hash.slice(0, 24)}`,
      sourceType: 'FINANCIAL_NEWS',
      sourceName: policy.name,
      sourceUrl: link,
      sourceDocumentId: null,
      publishedAt: publication,
      retrievedAt,
      eventAt: publication,
      title,
      rawText: description || null,
      contentHash: hash,
      language: options.language || 'en',
      companyIds: [company.companyId],
      claimType: 'ESTIMATE',
      reliabilityTier: policy.reliabilityTier,
      isPrimarySource: false,
      independenceGroup: `publisher:${normalizedPublisher(policy.name)}`,
      supportsClaimIds: [],
      contradictsClaimIds: [],
      expiresAt,
      notes: 'Trusted-publisher discovery evidence from an RSS aggregator. Full article review is required before recommendation-grade use.',
    });
  }

  return { records, rejected };
}

export async function fetchTrustedNewsEvidence(company, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Trusted news adapter requires fetch');

  const query = options.query || `"${company.displayName || company.legalName}" ${company.primaryListing?.symbol || ''}`.trim();
  const language = options.language || 'en-US';
  const country = options.country || 'US';
  const edition = options.edition || 'US:en';
  const url = options.url || `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${encodeURIComponent(language)}&gl=${encodeURIComponent(country)}&ceid=${encodeURIComponent(edition)}`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/rss+xml, application/xml, text/xml',
      'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/0.5',
    },
  });
  if (!response.ok) {
    return {
      records: [],
      diagnostics: [{ code: 'TRUSTED_NEWS_HTTP_ERROR', companyId: company.companyId, status: response.status }],
    };
  }

  const xml = await response.text();
  const extracted = extractTrustedNewsEvidence(xml, company, {
    retrievedAt: options.retrievedAt,
    publishers: options.publishers,
    limit: options.limit,
    expiryDays: options.expiryDays,
    language: options.recordLanguage || 'en',
  });
  let records = extracted.records;
  const diagnostics = [...extracted.rejected.slice(0, 20)];

  if (options.review !== false && records.length) {
    const reviewed = await reviewTrustedNewsRecords(records, company, {
      fetchImpl,
      reviewedAt: options.retrievedAt,
      limit: options.reviewLimit ?? 3,
      userAgent: options.userAgent || 'Investor-Control-Market-Intelligence/0.5',
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
      ...(records.length ? [] : [{ code: 'NO_ALLOWLISTED_NEWS_MATCHES', companyId: company.companyId }]),
    ],
  };
}

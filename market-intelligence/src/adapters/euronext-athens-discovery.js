import { contentHash } from '../content-hash.js';

export const ATHENS_DISCOVERY_VERSION = '2026-08-04.3';
export const ATHENS_ISSUERS_URL = 'https://athens.euronext.com/en/market-data/issuers?letter=X';
export const ATHENS_ANNOUNCEMENTS_URL = 'https://athens.euronext.com/en/market-data/announcements';
export const ATHENS_STOCKS_URL = 'https://athens.euronext.com/en/market-data/instruments/stocks';
export const ATHENS_SEARCH_URL = 'https://athens.euronext.com/en/search';

function decodeHtml(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function plainText(value) {
  return decodeHtml(String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(value) {
  try {
    return new URL(String(value || ''), 'https://athens.euronext.com').toString();
  } catch {
    return null;
  }
}

function normalizedName(value) {
  return plainText(value)
    .toUpperCase()
    .replace(/\b(SOCIETE ANONYME|S\.A\.|SA|PLC|AG|HOLDINGS?|CORPORATION|CORP\.?|INC\.?)\b/g, ' ')
    .replace(/[^A-Z0-9Α-Ω]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAthensDate(value, fallback) {
  const raw = plainText(value);
  const match = raw.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return new Date(fallback).toISOString();
  const [, day, month, year, hour = '12', minute = '00'] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 3, Number(minute)));
  return Number.isNaN(date.getTime()) ? new Date(fallback).toISOString() : date.toISOString();
}

function companyFromIssuer({ issuerId = null, taxonomyTermId = null, name, sourceUrl = null }, generatedAt) {
  const identity = issuerId ? `issuer-${issuerId}` : `term-${taxonomyTermId}`;
  return {
    companyId: `company:xath:${identity}`,
    legalName: name,
    displayName: name,
    aliases: [name],
    country: 'GR',
    issuerId: issuerId ? String(issuerId) : null,
    taxonomyTermId: taxonomyTermId ? String(taxonomyTermId) : null,
    cik: null,
    lei: null,
    primaryListing: {
      symbol: null,
      mic: 'XATH',
      exchange: 'Euronext Athens',
      currency: 'EUR',
    },
    regulator: 'Euronext Athens / Hellenic Capital Market framework',
    investorRelationsUrl: sourceUrl || (issuerId ? `https://athens.euronext.com/en/market-data/issuers/${issuerId}` : null),
    active: true,
    discoveredAt: generatedAt,
  };
}

function issuerAnchors(html) {
  const source = String(html || '');
  const anchors = [];
  const seen = new Set();
  const add = (issuerId, name, href) => {
    const cleanId = String(issuerId || '').trim();
    const cleanName = plainText(name);
    if (!cleanId || !cleanName || seen.has(cleanId)) return;
    if (/financial data|announcements|corporate actions|related instruments|issuer profile|learn more/i.test(cleanName)) return;
    seen.add(cleanId);
    anchors.push({ issuerId: cleanId, name: cleanName, sourceUrl: absoluteUrl(href) });
  };

  const anchorPattern = /<a\b[^>]*href=["']([^"']*\/market-data\/issuers\/(\d+)(?:[/?#][^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(source))) add(match[2], match[3], match[1]);

  const optionPattern = /<option\b[^>]*(?:value|data-url)=["']([^"']*\/market-data\/issuers\/(\d+)(?:[/?#][^"']*)?)["'][^>]*>([\s\S]*?)<\/option>/gi;
  while ((match = optionPattern.exec(source))) add(match[2], match[3], match[1]);

  const dataPattern = /<(?:div|li|article)\b[^>]*(?:data-href|data-url)=["']([^"']*\/market-data\/issuers\/(\d+)(?:[/?#][^"']*)?)["'][^>]*>([\s\S]*?)<\/(?:div|li|article)>/gi;
  while ((match = dataPattern.exec(source))) add(match[2], match[3], match[1]);

  return anchors;
}

function issuerTaxonomyOptions(html) {
  const source = String(html || '');
  const options = [];
  const seen = new Set();
  const pattern = /<input\b([^>]*)>\s*<label\b[^>]*>([\s\S]*?)<\/label>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const attrs = match[1];
    const name = plainText(match[2]);
    const fieldName = attrs.match(/\bname=["']([^"']+)["']/i)?.[1] || '';
    const termId = attrs.match(/\bvalue=["'](\d+)["']/i)?.[1] || null;
    if (fieldName !== 'field_mig_category_2' || !termId || !name || seen.has(termId)) continue;
    seen.add(termId);
    options.push({ taxonomyTermId: termId, name, sourceUrl: null });
  }
  return options;
}

export function extractAthensIssuerUniverse(html, options = {}) {
  const generatedAt = new Date(options.generatedAt || Date.now()).toISOString();
  const byName = new Map();
  for (const item of issuerTaxonomyOptions(html)) {
    byName.set(normalizedName(item.name), companyFromIssuer(item, generatedAt));
  }
  for (const item of issuerAnchors(html)) {
    const key = normalizedName(item.name);
    const existing = byName.get(key);
    const canonical = companyFromIssuer({
      ...item,
      taxonomyTermId: existing?.taxonomyTermId || null,
    }, generatedAt);
    byName.set(key, canonical);
  }
  const companies = [...byName.values()];
  return {
    companies,
    diagnostics: companies.length ? [] : [{ code: 'ATHENS_ISSUER_UNIVERSE_EMPTY' }],
  };
}

function tableRows(html) {
  return String(html || '').match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
}

function cells(row) {
  return (String(row || '').match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) || []).map((cell) => plainText(cell));
}

function rowIssuerIdentity(row, fallbackName) {
  const match = String(row || '').match(/<a\b[^>]*href=["']([^"']*\/market-data\/issuers\/(\d+)(?:[/?#][^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/i);
  if (!match) return null;
  return {
    issuerId: match[2],
    name: plainText(match[3]) || plainText(fallbackName),
    sourceUrl: absoluteUrl(match[1]),
  };
}

function announcementLink(row) {
  const matches = [...String(row || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const preferred = matches.find((match) => /\/node\/\d+|announc/i.test(match[1]))
    || matches.find((match) => !/\/market-data\/issuers\/\d+/i.test(match[1]))
    || matches.at(-1);
  return preferred ? { sourceUrl: absoluteUrl(preferred[1]), anchorText: plainText(preferred[2]) } : null;
}

function bestCompanyMatch(issuerName, issuerUniverse, byName, rowIdentity, generatedAt) {
  const key = normalizedName(issuerName);
  const exact = byName.get(key);
  if (exact) return exact;
  const fuzzy = issuerUniverse.find((company) => {
    const a = normalizedName(company.displayName || company.legalName);
    return a && key && (a.includes(key) || key.includes(a));
  });
  if (fuzzy) return fuzzy;
  if (rowIdentity?.issuerId) return companyFromIssuer({
    ...rowIdentity,
    name: rowIdentity.name || issuerName,
  }, generatedAt);
  return null;
}

export function extractAthensAnnouncements(html, issuerUniverse = [], options = {}) {
  const retrievedAt = new Date(options.retrievedAt || Date.now()).toISOString();
  const byName = new Map();
  const discoveredById = new Map(issuerUniverse.map((company) => [company.companyId, company]));
  for (const company of issuerUniverse) {
    const key = normalizedName(company.displayName || company.legalName);
    if (key) byName.set(key, company);
  }
  const records = [];
  const diagnostics = [];

  for (const row of tableRows(html)) {
    const values = cells(row);
    if (values.length < 3) continue;
    const issuerName = values[0];
    const title = values[1];
    const dateText = values[2];
    if (!issuerName || !title || !/\d{1,2}[-/.]\d{1,2}[-/.]\d{4}/.test(dateText)) continue;
    const rowIdentity = rowIssuerIdentity(row, issuerName);
    const company = bestCompanyMatch(issuerName, [...discoveredById.values()], byName, rowIdentity, retrievedAt);
    if (!company) {
      diagnostics.push({ code: 'ATHENS_ISSUER_IDENTITY_UNRESOLVED', issuerName, title });
      continue;
    }
    if (!discoveredById.has(company.companyId)) {
      discoveredById.set(company.companyId, company);
      const key = normalizedName(company.displayName || company.legalName);
      if (key) byName.set(key, company);
    }
    const link = announcementLink(row);
    const publishedAt = parseAthensDate(dateText, retrievedAt);
    const hash = contentHash({ issuerName, title, publishedAt, sourceUrl: link?.sourceUrl });
    records.push({
      id: `evidence:xath:${hash.slice(0, 24)}`,
      sourceType: 'EXCHANGE_ANNOUNCEMENT',
      sourceName: 'Euronext Athens',
      sourceUrl: link?.sourceUrl || ATHENS_ANNOUNCEMENTS_URL,
      sourceDocumentId: link?.sourceUrl?.match(/\/node\/(\d+)/)?.[1] || null,
      publishedAt,
      retrievedAt,
      eventAt: publishedAt,
      title,
      rawText: null,
      contentHash: hash,
      language: 'en',
      companyIds: [company.companyId],
      companyId: company.companyId,
      issuerId: company.issuerId,
      taxonomyTermId: company.taxonomyTermId,
      claimType: 'FACT',
      reliabilityTier: 1,
      isPrimarySource: true,
      independenceGroup: 'exchange:euronext-athens',
      supportsClaimIds: [],
      contradictsClaimIds: [],
      expiresAt: new Date(new Date(publishedAt).getTime() + 14 * 86_400_000).toISOString(),
      notes: 'Official Euronext Athens issuer announcement discovered by the autonomous market scanner.',
      form: 'ATHEX_ANNOUNCEMENT',
      summary: title,
    });
  }

  return { records, companies: [...discoveredById.values()], diagnostics };
}

function stockLinkCandidates(html) {
  const source = String(html || '');
  const candidates = [];
  const pattern = /<a\b[^>]*href=["']([^"']*\/market-data\/instruments\/stocks\/([A-Z0-9._-]+)(?:[/?#][^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    candidates.push({
      symbol: String(match[2]).toUpperCase(),
      label: plainText(match[3]),
      sourceUrl: absoluteUrl(match[1]),
      context: plainText(source.slice(Math.max(0, match.index - 700), Math.min(source.length, pattern.lastIndex + 700))),
    });
  }
  return candidates;
}

function issuerLinkCandidates(html) {
  const source = String(html || '');
  const candidates = [];
  const pattern = /<a\b[^>]*href=["']([^"']*\/market-data\/issuers\/(\d+)(?:[/?#][^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    candidates.push({
      issuerId: match[2],
      label: plainText(match[3]),
      sourceUrl: absoluteUrl(match[1]),
      context: plainText(source.slice(Math.max(0, match.index - 700), Math.min(source.length, pattern.lastIndex + 700))),
    });
  }
  return candidates;
}

function bestIdentityCandidate(candidates, company) {
  const target = normalizedName(company.displayName || company.legalName);
  const exact = candidates.find((item) => normalizedName(item.label) === target);
  if (exact) return exact;
  const contextual = candidates.find((item) => {
    const label = normalizedName(item.label);
    const context = normalizedName(item.context);
    return (label && target && (label.includes(target) || target.includes(label))) || (context && target && context.includes(target));
  });
  return contextual || (candidates.length === 1 ? candidates[0] : null);
}

export function extractAthensRelatedInstrument(html, company) {
  const source = String(html || '');
  const text = plainText(source);
  const linked = bestIdentityCandidate(stockLinkCandidates(source), company);
  const tableSymbol = text.match(/\bSymbol\s+([A-Z0-9._-]{1,16})\s+(?:Product\s+)?Stock\b/i)?.[1] || null;
  const distributionSymbol = text.match(/\bSymbol\s+(?:Amount[^A-Z0-9]+)?([A-Z][A-Z0-9._-]{0,15})\s+(?:\d|Amount|Type|Dividend|Cash)/i)?.[1] || null;
  const symbol = String(linked?.symbol || tableSymbol || distributionSymbol || '').trim().toUpperCase() || null;
  return symbol ? {
    ...company,
    primaryListing: { ...company.primaryListing, symbol },
    aliases: [...new Set([...(company.aliases || []), symbol])],
    instrumentUrl: linked?.sourceUrl || company.instrumentUrl || null,
  } : null;
}

export function extractAthensSearchIdentity(html, company) {
  const stock = bestIdentityCandidate(stockLinkCandidates(html), company);
  const issuer = bestIdentityCandidate(issuerLinkCandidates(html), company);
  if (!stock && !issuer) return null;
  return {
    ...company,
    issuerId: issuer?.issuerId || company.issuerId || null,
    investorRelationsUrl: issuer?.sourceUrl || company.investorRelationsUrl || null,
    primaryListing: {
      ...company.primaryListing,
      symbol: stock?.symbol || company.primaryListing?.symbol || null,
    },
    aliases: [...new Set([...(company.aliases || []), stock?.symbol].filter(Boolean))],
    instrumentUrl: stock?.sourceUrl || company.instrumentUrl || null,
  };
}

async function fetchText(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/1.2',
    },
    signal: options.signal,
  });
  if (!response?.ok) throw new Error(`HTTP ${response?.status || 'unknown'}`);
  return response.text();
}

async function resolveCompanyIdentity(fetchImpl, company, options, diagnostics) {
  const query = encodeURIComponent(company.displayName || company.legalName);
  const searchCandidates = [
    `${ATHENS_STOCKS_URL}?search_api_fulltext=${query}`,
    `${ATHENS_STOCKS_URL}?query=${query}`,
    `${ATHENS_SEARCH_URL}?term=${query}`,
  ];
  let resolved = company;
  for (const url of searchCandidates) {
    try {
      const html = await fetchText(fetchImpl, url, options);
      const identified = extractAthensSearchIdentity(html, resolved);
      if (identified) resolved = identified;
      if (resolved.primaryListing?.symbol && resolved.issuerId) return resolved;
    } catch (error) {
      diagnostics.push({
        code: 'ATHENS_IDENTITY_SEARCH_FAILED',
        companyId: company.companyId,
        endpoint: new URL(url).pathname,
        errorClass: String(error?.message || error).startsWith('HTTP') ? String(error.message) : 'NETWORK_OR_PARSE_ERROR',
      });
    }
  }
  return resolved;
}

async function resolveCompanySymbol(fetchImpl, company, options, diagnostics) {
  let resolved = await resolveCompanyIdentity(fetchImpl, company, options, diagnostics);
  if (resolved.primaryListing?.symbol) return resolved;
  if (!resolved.issuerId) {
    diagnostics.push({ code: 'ATHENS_ISSUER_ID_NOT_RESOLVED', companyId: company.companyId, taxonomyTermId: company.taxonomyTermId || null });
    return resolved;
  }
  const candidates = [
    `https://athens.euronext.com/en/market-data/issuers/${resolved.issuerId}/related-instruments`,
    `https://athens.euronext.com/en/market-data/issuers/${resolved.issuerId}/cash-distribution`,
    `https://athens.euronext.com/en/market-data/issuers/${resolved.issuerId}`,
  ];
  for (const url of candidates) {
    try {
      const html = await fetchText(fetchImpl, url, options);
      const identified = extractAthensRelatedInstrument(html, resolved);
      if (identified) return identified;
    } catch (error) {
      diagnostics.push({
        code: 'ATHENS_RELATED_INSTRUMENT_FETCH_FAILED',
        companyId: company.companyId,
        endpoint: new URL(url).pathname,
        errorClass: String(error?.message || error).startsWith('HTTP') ? String(error.message) : 'NETWORK_OR_PARSE_ERROR',
      });
    }
  }
  diagnostics.push({ code: 'ATHENS_SYMBOL_NOT_RESOLVED', companyId: company.companyId, issuerId: resolved.issuerId });
  return resolved;
}

export async function fetchAthensDiscovery(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const generatedAt = new Date(options.generatedAt || Date.now()).toISOString();
  if (typeof fetchImpl !== 'function') {
    return { companies: [], records: [], diagnostics: [{ code: 'ATHENS_DISCOVERY_FETCH_UNAVAILABLE' }] };
  }
  try {
    const [issuerHtml, announcementHtml] = await Promise.all([
      fetchText(fetchImpl, options.issuersUrl || ATHENS_ISSUERS_URL, options),
      fetchText(fetchImpl, options.announcementsUrl || ATHENS_ANNOUNCEMENTS_URL, options),
    ]);
    const universe = extractAthensIssuerUniverse(`${issuerHtml}\n${announcementHtml}`, { generatedAt });
    const announcements = extractAthensAnnouncements(announcementHtml, universe.companies, { retrievedAt: generatedAt });
    const companyPool = announcements.companies || universe.companies;
    const activeCompanyIds = [...new Set(announcements.records.map((record) => record.companyId))]
      .slice(0, Math.max(1, Number(options.identityResolutionLimit ?? 20)));
    const diagnostics = [...universe.diagnostics, ...announcements.diagnostics]
      .filter((item) => !(item.code === 'ATHENS_ISSUER_UNIVERSE_EMPTY' && companyPool.length));
    const companies = [];

    for (const companyId of activeCompanyIds) {
      const company = companyPool.find((item) => item.companyId === companyId);
      if (!company) {
        diagnostics.push({ code: 'ATHENS_COMPANY_RECORD_MISSING', companyId });
        continue;
      }
      companies.push(await resolveCompanySymbol(fetchImpl, company, options, diagnostics));
    }

    return {
      format: 'investor-control-athens-discovery',
      version: 3,
      policyVersion: ATHENS_DISCOVERY_VERSION,
      generatedAt,
      companies,
      records: announcements.records,
      diagnostics,
    };
  } catch (error) {
    return {
      format: 'investor-control-athens-discovery',
      version: 3,
      policyVersion: ATHENS_DISCOVERY_VERSION,
      generatedAt,
      companies: [],
      records: [],
      diagnostics: [{
        code: 'ATHENS_DISCOVERY_FAILED',
        errorClass: String(error?.message || error).startsWith('HTTP') ? String(error.message) : 'NETWORK_OR_PARSE_ERROR',
      }],
    };
  }
}

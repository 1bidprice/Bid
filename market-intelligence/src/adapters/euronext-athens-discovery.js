import { contentHash } from '../content-hash.js';

export const ATHENS_DISCOVERY_VERSION = '2026-08-04.2';
export const ATHENS_ISSUERS_URL = 'https://athens.euronext.com/en/market-data/issuers?letter=X';
export const ATHENS_ANNOUNCEMENTS_URL = 'https://athens.euronext.com/en/market-data/announcements';

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

function companyFromIssuer({ issuerId, name, sourceUrl }, generatedAt) {
  return {
    companyId: `company:xath:${issuerId}`,
    legalName: name,
    displayName: name,
    aliases: [name],
    country: 'GR',
    issuerId,
    cik: null,
    lei: null,
    primaryListing: {
      symbol: null,
      mic: 'XATH',
      exchange: 'Euronext Athens',
      currency: 'EUR',
    },
    regulator: 'Euronext Athens / Hellenic Capital Market framework',
    investorRelationsUrl: sourceUrl || `https://athens.euronext.com/en/market-data/issuers/${issuerId}`,
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

export function extractAthensIssuerUniverse(html, options = {}) {
  const generatedAt = new Date(options.generatedAt || Date.now()).toISOString();
  const companies = issuerAnchors(html).map((item) => companyFromIssuer(item, generatedAt));
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

export function extractAthensRelatedInstrument(html, company) {
  const source = String(html || '');
  const text = plainText(source);
  const hrefSymbol = source.match(/\/market-data\/instruments\/stocks\/([A-Z0-9._-]+)/i)?.[1] || null;
  const productRow = source.match(/<tr\b[\s\S]*?<a\b[^>]*href=["'][^"']*\/market-data\/instruments\/stocks\/([A-Z0-9._-]+)[^"']*["'][^>]*>[\s\S]*?<\/tr>/i)?.[1] || null;
  const tableSymbol = text.match(/\bSymbol\s+([A-Z0-9._-]{1,16})\s+(?:Product\s+)?Stock\b/i)?.[1] || null;
  const distributionSymbol = text.match(/\bSymbol\s+(?:Amount[^A-Z0-9]+)?([A-Z][A-Z0-9._-]{0,15})\s+(?:\d|Amount|Type|Dividend|Cash)/i)?.[1] || null;
  const symbol = String(hrefSymbol || productRow || tableSymbol || distributionSymbol || '').trim().toUpperCase() || null;
  return symbol ? {
    ...company,
    primaryListing: { ...company.primaryListing, symbol },
    aliases: [...new Set([...(company.aliases || []), symbol])],
  } : null;
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

async function resolveCompanySymbol(fetchImpl, company, options, diagnostics) {
  const candidates = [
    `https://athens.euronext.com/en/market-data/issuers/${company.issuerId}/related-instruments`,
    `https://athens.euronext.com/en/market-data/issuers/${company.issuerId}/cash-distribution`,
    `https://athens.euronext.com/en/market-data/issuers/${company.issuerId}`,
  ];
  for (const url of candidates) {
    try {
      const html = await fetchText(fetchImpl, url, options);
      const identified = extractAthensRelatedInstrument(html, company);
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
  diagnostics.push({ code: 'ATHENS_SYMBOL_NOT_RESOLVED', companyId: company.companyId });
  return company;
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
      if (!company?.issuerId) {
        diagnostics.push({ code: 'ATHENS_ISSUER_ID_MISSING', companyId });
        continue;
      }
      companies.push(await resolveCompanySymbol(fetchImpl, company, options, diagnostics));
    }

    return {
      format: 'investor-control-athens-discovery',
      version: 2,
      policyVersion: ATHENS_DISCOVERY_VERSION,
      generatedAt,
      companies,
      records: announcements.records,
      diagnostics,
    };
  } catch (error) {
    return {
      format: 'investor-control-athens-discovery',
      version: 2,
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

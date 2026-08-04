import { contentHash } from '../content-hash.js';

export const ATHENS_DISCOVERY_VERSION = '2026-08-04.1';
export const ATHENS_ISSUERS_URL = 'https://athens.euronext.com/en/market-data/issuers';
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
  return decodeHtml(String(value || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
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

function issuerAnchors(html) {
  const anchors = [];
  const pattern = /<a\b[^>]*href=["']([^"']*\/market-data\/issuers\/(\d+)(?:[/?#][^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(String(html || '')))) {
    const name = plainText(match[3]);
    if (!name || /financial data|announcements|corporate actions|related instruments/i.test(name)) continue;
    anchors.push({ issuerId: match[2], name, sourceUrl: absoluteUrl(match[1]) });
  }
  return anchors;
}

export function extractAthensIssuerUniverse(html, options = {}) {
  const generatedAt = new Date(options.generatedAt || Date.now()).toISOString();
  const byId = new Map();
  for (const item of issuerAnchors(html)) {
    if (!byId.has(item.issuerId)) byId.set(item.issuerId, item);
  }
  const companies = [...byId.values()].map((item) => ({
    companyId: `company:xath:${item.issuerId}`,
    legalName: item.name,
    displayName: item.name,
    aliases: [item.name],
    country: 'GR',
    issuerId: item.issuerId,
    cik: null,
    lei: null,
    primaryListing: {
      symbol: null,
      mic: 'XATH',
      exchange: 'Euronext Athens',
      currency: 'EUR',
    },
    regulator: 'Euronext Athens / Hellenic Capital Market framework',
    investorRelationsUrl: item.sourceUrl,
    active: true,
    discoveredAt: generatedAt,
  }));
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

function announcementLink(row) {
  const matches = [...String(row || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const preferred = matches.find((match) => /\/node\/\d+|announc/i.test(match[1])) || matches.at(-1);
  return preferred ? { sourceUrl: absoluteUrl(preferred[1]), anchorText: plainText(preferred[2]) } : null;
}

export function extractAthensAnnouncements(html, issuerUniverse = [], options = {}) {
  const retrievedAt = new Date(options.retrievedAt || Date.now()).toISOString();
  const byName = new Map();
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
    const link = announcementLink(row);
    const exact = byName.get(normalizedName(issuerName));
    const fuzzy = exact || issuerUniverse.find((company) => {
      const a = normalizedName(company.displayName || company.legalName);
      const b = normalizedName(issuerName);
      return a && b && (a.includes(b) || b.includes(a));
    });
    if (!fuzzy) {
      diagnostics.push({ code: 'ATHENS_ISSUER_IDENTITY_UNRESOLVED', issuerName, title });
      continue;
    }
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
      companyIds: [fuzzy.companyId],
      companyId: fuzzy.companyId,
      issuerId: fuzzy.issuerId,
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

  return { records, diagnostics };
}

export function extractAthensRelatedInstrument(html, company) {
  const text = plainText(html);
  const hrefSymbol = String(html || '').match(/\/market-data\/instruments\/stocks\/([A-Z0-9._-]+)/i)?.[1] || null;
  const tableSymbol = text.match(/\bSymbol\s+([A-Z0-9._-]{1,16})\s+(?:Product\s+)?Stock\b/i)?.[1] || null;
  const symbol = String(hrefSymbol || tableSymbol || '').trim().toUpperCase() || null;
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
      'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/1.1',
    },
    signal: options.signal,
  });
  if (!response?.ok) throw new Error(`HTTP ${response?.status || 'unknown'}`);
  return response.text();
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
    const universe = extractAthensIssuerUniverse(issuerHtml, { generatedAt });
    const announcements = extractAthensAnnouncements(announcementHtml, universe.companies, { retrievedAt: generatedAt });
    const activeCompanyIds = [...new Set(announcements.records.map((record) => record.companyId))]
      .slice(0, Math.max(1, Number(options.identityResolutionLimit ?? 12)));
    const resolved = [];
    const diagnostics = [...universe.diagnostics, ...announcements.diagnostics];

    for (const companyId of activeCompanyIds) {
      const company = universe.companies.find((item) => item.companyId === companyId);
      if (!company?.issuerId) continue;
      try {
        const html = await fetchText(fetchImpl, `https://athens.euronext.com/en/market-data/issuers/${company.issuerId}/related-instruments`, options);
        const identified = extractAthensRelatedInstrument(html, company);
        if (identified) resolved.push(identified);
        else diagnostics.push({ code: 'ATHENS_SYMBOL_NOT_RESOLVED', companyId });
      } catch (error) {
        diagnostics.push({ code: 'ATHENS_RELATED_INSTRUMENT_FETCH_FAILED', companyId, errorClass: String(error?.message || error).startsWith('HTTP') ? String(error.message) : 'NETWORK_OR_PARSE_ERROR' });
      }
    }

    const resolvedById = new Map(resolved.map((company) => [company.companyId, company]));
    const companies = universe.companies
      .filter((company) => activeCompanyIds.includes(company.companyId))
      .map((company) => resolvedById.get(company.companyId) || company);

    return {
      format: 'investor-control-athens-discovery',
      version: 1,
      policyVersion: ATHENS_DISCOVERY_VERSION,
      generatedAt,
      companies,
      records: announcements.records,
      diagnostics,
    };
  } catch (error) {
    return {
      format: 'investor-control-athens-discovery',
      version: 1,
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

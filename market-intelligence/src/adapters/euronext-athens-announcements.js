import { contentHash } from '../content-hash.js';

function decodeHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(value) {
  const match = String(value || '').match(/(\d{1,2})[-\/]([01]?\d)[-\/](\d{4})(?:\s+([0-2]?\d):([0-5]\d))?/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4] || 12);
  const minute = Number(match[5] || 0);
  if (!day || !month || !year) return null;
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0)).toISOString();
}

function recordFromRow(row, options) {
  const hrefMatch = row.match(/href=["']([^"']+)["']/i);
  if (!hrefMatch) return null;
  const relativeUrl = hrefMatch[1];
  if (!/(?:\/node\/\d+|\/more-options\/announcements\/|\/market-data\/announcements\/)/i.test(relativeUrl)) return null;
  const anchorMatch = row.match(/<a[^>]*href=["'][^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
  const title = decodeHtml(anchorMatch?.[1]);
  const dateMatch = decodeHtml(row).match(/\d{1,2}[-\/]\d{1,2}[-\/]\d{4}(?:\s+\d{1,2}:\d{2})?/);
  const publishedAt = parseDate(dateMatch?.[0]);
  if (!title || !publishedAt) return null;
  const sourceUrl = new URL(relativeUrl, options.baseUrl).toString();
  return {
    id: `evidence:euronext-athens:${contentHash(sourceUrl).slice(0, 24)}`,
    sourceType: 'EXCHANGE_ANNOUNCEMENT',
    sourceName: 'Euronext Athens Issuer Announcements',
    sourceUrl,
    sourceDocumentId: null,
    publishedAt,
    retrievedAt: options.retrievedAt,
    eventAt: publishedAt,
    title,
    rawText: null,
    contentHash: contentHash({ sourceUrl, publishedAt, title }),
    language: 'en',
    companyIds: [options.companyId],
    claimType: 'FACT',
    reliabilityTier: 1,
    isPrimarySource: true,
    independenceGroup: `euronext-athens:${options.companyId}`,
    supportsClaimIds: [],
    contradictsClaimIds: [],
    expiresAt: null,
    notes: 'Official Euronext Athens issuer announcement index entry.',
  };
}

export function extractEuronextAthensAnnouncements(html, options = {}) {
  const baseUrl = options.baseUrl || 'https://athens.euronext.com';
  const retrievedAt = new Date(options.retrievedAt || Date.now()).toISOString();
  const companyId = options.companyId;
  const limit = Math.max(1, Number(options.limit || 25));
  const records = [];
  const seen = new Set();
  const source = String(html || '');
  const rowPattern = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
  let match;

  while ((match = rowPattern.exec(source)) && records.length < limit) {
    const record = recordFromRow(match[0], { baseUrl, retrievedAt, companyId });
    if (!record || seen.has(record.sourceUrl)) continue;
    seen.add(record.sourceUrl);
    records.push(record);
  }

  if (!records.length) {
    const linkPattern = /href=["']([^"']*(?:\/node\/\d+|\/more-options\/announcements\/[^"']+))["'][^>]*>([\s\S]*?)<\/a>[\s\S]{0,500}?(\d{1,2}[-\/]\d{1,2}[-\/]\d{4}(?:\s+\d{1,2}:\d{2})?)/gi;
    while ((match = linkPattern.exec(source)) && records.length < limit) {
      const sourceUrl = new URL(match[1], baseUrl).toString();
      const title = decodeHtml(match[2]);
      const publishedAt = parseDate(match[3]);
      if (!title || !publishedAt || seen.has(sourceUrl)) continue;
      seen.add(sourceUrl);
      records.push({
        id: `evidence:euronext-athens:${contentHash(sourceUrl).slice(0, 24)}`,
        sourceType: 'EXCHANGE_ANNOUNCEMENT',
        sourceName: 'Euronext Athens Issuer Announcements',
        sourceUrl,
        sourceDocumentId: null,
        publishedAt,
        retrievedAt,
        eventAt: publishedAt,
        title,
        rawText: null,
        contentHash: contentHash({ sourceUrl, publishedAt, title }),
        language: 'en',
        companyIds: [companyId],
        claimType: 'FACT',
        reliabilityTier: 1,
        isPrimarySource: true,
        independenceGroup: `euronext-athens:${companyId}`,
        supportsClaimIds: [],
        contradictsClaimIds: [],
        expiresAt: null,
        notes: 'Official Euronext Athens issuer announcement index entry.',
      });
    }
  }

  records.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  return records.slice(0, limit);
}

export async function fetchEuronextAthensAnnouncements(company, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Euronext Athens announcements adapter requires fetch');
  const url = company.marketData?.euronextIssuerAnnouncementsUrl;
  if (!url) {
    return { records: [], diagnostics: [{ code: 'EURONEXT_ATHENS_ISSUER_URL_MISSING', companyId: company.companyId }] };
  }
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Cache-Control': 'no-cache',
      'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/1.0',
    },
  });
  if (!response.ok) {
    return {
      records: [],
      diagnostics: [{ code: 'EURONEXT_ATHENS_ANNOUNCEMENTS_HTTP_ERROR', companyId: company.companyId, status: response.status }],
    };
  }
  const records = extractEuronextAthensAnnouncements(await response.text(), {
    companyId: company.companyId,
    retrievedAt: options.retrievedAt,
    limit: options.limit,
  });
  return {
    records,
    diagnostics: records.length ? [] : [{ code: 'EURONEXT_ATHENS_ANNOUNCEMENTS_NOT_PARSED', companyId: company.companyId }],
  };
}

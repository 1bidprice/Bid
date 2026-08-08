import { contentHash } from '../content-hash.js';

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function decodeHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseEnglishDate(value) {
  const match = String(value || '').match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1]), 12, 0, 0)).toISOString();
}

export function extractAllwynAnnouncements(html, options = {}) {
  const baseUrl = options.baseUrl || 'https://www.allwyn.com';
  const retrievedAt = new Date(options.retrievedAt || Date.now()).toISOString();
  const companyId = options.companyId || 'company:allwyn-ag';
  const limit = Number(options.limit || 25);
  const records = [];
  const seen = new Set();

  const pattern = /(\d{1,2}\s+[A-Za-z]+\s+\d{4})[\s\S]{0,1800}?href=["']([^"']*\/regulatory-announcements\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = pattern.exec(String(html || ''))) && records.length < limit) {
    const publishedAt = parseEnglishDate(match[1]);
    const relativeUrl = match[2];
    const title = decodeHtml(match[3]);
    if (!publishedAt || !relativeUrl || !title) continue;

    const sourceUrl = new URL(relativeUrl, baseUrl).toString();
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);

    records.push({
      id: `evidence:allwyn:${contentHash(sourceUrl).slice(0, 24)}`,
      sourceType: 'ISSUER_IR',
      sourceName: 'Allwyn Regulatory Announcements',
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
      independenceGroup: 'allwyn-official',
      supportsClaimIds: [],
      contradictsClaimIds: [],
      expiresAt: null,
      notes: 'Official issuer regulatory announcement index entry.',
    });
  }

  return records;
}

export async function fetchAllwynRegulatoryAnnouncements(company, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Allwyn adapter requires fetch');

  const url = options.url || 'https://www.allwyn.com/regulatory-announcements';
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/0.1',
    },
  });

  if (!response.ok) {
    throw new Error(`Allwyn regulatory announcements request failed: ${response.status}`);
  }

  const html = await response.text();
  const records = extractAllwynAnnouncements(html, {
    companyId: company.companyId,
    retrievedAt: options.retrievedAt,
    limit: options.limit,
  });

  return {
    records,
    diagnostics: records.length
      ? []
      : [{ code: 'ALLWYN_ANNOUNCEMENTS_NOT_PARSED', companyId: company.companyId }],
  };
}

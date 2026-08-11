import { buildAthensForecastClassificationSnapshot } from '../forecast-classification-lineage.js';

export const ATHENS_ICB_CLASSIFICATION_ADAPTER_VERSION = '2026-08-11.1';

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

function splitSectorSubSector(value) {
  const text = plainText(value);
  const slash = text.indexOf('/');
  if (slash <= 0 || slash >= text.length - 1) return null;
  const sector = text.slice(0, slash).trim();
  const subSector = text.slice(slash + 1).trim();
  if (!sector || !subSector || sector.includes('/') || subSector.includes('/')) return null;
  return { sector, subSector };
}

export function extractAthensIcbClassification(html) {
  const source = String(html || '');
  const rows = source.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  const matches = [];

  for (const row of rows) {
    const cells = row.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) || [];
    if (cells.length < 2) continue;
    const labels = cells.map(plainText);
    const labelIndex = labels.findIndex((value) => /^Sector\s*\/\s*Sub-sector$/i.test(value));
    if (labelIndex < 0) continue;
    const candidate = splitSectorSubSector(labels[labelIndex + 1] || '');
    if (candidate) matches.push(candidate);
  }

  if (!matches.length) {
    const text = plainText(source);
    const match = text.match(/Sector\s*\/\s*Sub-sector\s+([^/|]+?)\s*\/\s*([^|]+?)(?=\s{2,}|\s+(?:ISIN|Symbol|Market|Issuer|Address|Phone|Website|LEI|Trading)|$)/i);
    if (match) {
      const sector = plainText(match[1]);
      const subSector = plainText(match[2]);
      if (sector && subSector && !sector.includes('/') && !subSector.includes('/')) matches.push({ sector, subSector });
    }
  }

  const unique = [...new Map(matches.map((item) => [`${item.sector}\u0000${item.subSector}`, item])).values()];
  if (unique.length !== 1) {
    return {
      classification: null,
      diagnostics: [{ code: unique.length ? 'ATHENS_ICB_CLASSIFICATION_AMBIGUOUS' : 'ATHENS_ICB_CLASSIFICATION_NOT_FOUND' }],
    };
  }
  return { classification: unique[0], diagnostics: [] };
}

export async function fetchAthensIcbClassificationSnapshot(company = {}, options = {}) {
  const companyId = company?.companyId || null;
  const issuerId = /^\d+$/.test(String(company?.issuerId || '').trim()) ? String(company.issuerId).trim() : null;
  if (!issuerId) {
    return {
      snapshot: null,
      diagnostics: [{ code: 'ATHENS_ICB_ISSUER_ID_REQUIRED', companyId }],
    };
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      snapshot: null,
      diagnostics: [{ code: 'ATHENS_ICB_FETCH_UNAVAILABLE', companyId, issuerId }],
    };
  }

  const sourceUrl = `https://athens.euronext.com/en/market-data/issuers/${issuerId}`;
  const capturedAt = new Date(options.capturedAt || options.retrievedAt || Date.now()).toISOString();
  try {
    const response = await fetchImpl(sourceUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/1.8',
      },
      signal: options.signal,
    });
    if (!response?.ok) {
      return {
        snapshot: null,
        diagnostics: [{ code: 'ATHENS_ICB_PROFILE_FETCH_FAILED', companyId, issuerId, errorClass: `HTTP ${response?.status || 'unknown'}` }],
      };
    }
    const parsed = extractAthensIcbClassification(await response.text());
    if (!parsed.classification) {
      return {
        snapshot: null,
        diagnostics: parsed.diagnostics.map((item) => ({ ...item, companyId, issuerId })),
      };
    }
    const built = buildAthensForecastClassificationSnapshot(company, { ...parsed.classification, issuerId }, { capturedAt });
    return {
      snapshot: built.snapshot,
      diagnostics: [...parsed.diagnostics, ...(built.diagnostics || [])],
    };
  } catch (error) {
    return {
      snapshot: null,
      diagnostics: [{
        code: 'ATHENS_ICB_PROFILE_FETCH_FAILED',
        companyId,
        issuerId,
        errorClass: String(error?.message || error).startsWith('HTTP') ? String(error.message) : 'NETWORK_OR_PARSE_ERROR',
      }],
    };
  }
}

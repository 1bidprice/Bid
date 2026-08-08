import { contentHash } from './content-hash.js';
import { htmlToPlainText } from './document-hydrator.js';
import { classifyEvidenceEvent } from './event-classifier.js';

const DEFAULT_MAX_BYTES = 1_500_000;
const DEFAULT_MIN_TEXT = 800;
const DEFAULT_MAX_RETAINED = 1_800;
const EVENT_TERMS = [
  'share buyback', 'repurchase', 'own shares', 'equity issuance', 'new shares', 'dilution',
  'debt refinancing', 'term loan', 'financial results', 'quarterly results', 'annual results',
  'revenue', 'free cash flow', 'flight test', 'commercial service', 'settlement', 'litigation',
];

function companyAliases(company) {
  return [company?.legalName, company?.displayName, company?.primaryListing?.symbol, ...(company?.aliases || [])]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .filter((value) => value.length >= 3);
}

function containsCompany(text, company) {
  const normalized = String(text || '').toLowerCase();
  return companyAliases(company).some((alias) => normalized.includes(alias));
}

function excerpt(text, index, length, radius = 260) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function retainedExcerpts(text, company, maxRetained) {
  const normalized = text.toLowerCase();
  const needles = [...companyAliases(company), ...EVENT_TERMS];
  const excerpts = [];
  const seen = new Set();
  for (const needle of needles) {
    const index = normalized.indexOf(needle);
    if (index < 0) continue;
    const value = excerpt(text, index, needle.length);
    const key = value.slice(0, 120);
    if (!seen.has(key)) {
      seen.add(key);
      excerpts.push(value);
    }
    if (excerpts.join('\n\n').length >= maxRetained || excerpts.length >= 5) break;
  }
  if (!excerpts.length) excerpts.push(text.slice(0, maxRetained).replace(/\s+/g, ' ').trim());
  return excerpts.join('\n\n').slice(0, maxRetained).trim();
}

function contentType(response) {
  return String(response?.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
}

export async function reviewTrustedNewsRecord(record, company, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Trusted news review requires fetch');
  const reviewedAt = new Date(options.reviewedAt || Date.now()).toISOString();
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES);
  const minText = Number(options.minText || DEFAULT_MIN_TEXT);
  const maxRetained = Number(options.maxRetained || DEFAULT_MAX_RETAINED);

  let response;
  try {
    response = await fetchImpl(record.sourceUrl, {
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2',
        'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/0.5',
      },
    });
  } catch (error) {
    return {
      record,
      diagnostics: [{ code: 'TRUSTED_NEWS_REVIEW_FETCH_FAILED', evidenceId: record.id, message: error instanceof Error ? error.message : String(error) }],
    };
  }

  if (!response.ok) {
    return {
      record,
      diagnostics: [{ code: 'TRUSTED_NEWS_REVIEW_HTTP_ERROR', evidenceId: record.id, status: response.status }],
    };
  }
  const type = contentType(response);
  if (type && !type.startsWith('text/') && type !== 'application/xhtml+xml') {
    return {
      record,
      diagnostics: [{ code: 'TRUSTED_NEWS_REVIEW_UNSUPPORTED_TYPE', evidenceId: record.id, contentType: type }],
    };
  }

  const body = await response.text();
  const byteLength = Buffer.byteLength(body, 'utf8');
  if (byteLength > maxBytes) {
    return {
      record,
      diagnostics: [{ code: 'TRUSTED_NEWS_REVIEW_TOO_LARGE', evidenceId: record.id, byteLength }],
    };
  }
  const text = type.includes('html') || /<\w[\s\S]*>/i.test(body)
    ? htmlToPlainText(body)
    : body.replace(/\s+/g, ' ').trim();
  if (text.length < minText) {
    return {
      record,
      diagnostics: [{ code: 'TRUSTED_NEWS_REVIEW_TEXT_TOO_SHORT', evidenceId: record.id, textLength: text.length }],
    };
  }
  if (!containsCompany(text, company)) {
    return {
      record,
      diagnostics: [{ code: 'TRUSTED_NEWS_REVIEW_COMPANY_NOT_FOUND', evidenceId: record.id }],
    };
  }

  const classification = classifyEvidenceEvent({ ...record, rawText: text });
  if (classification.eventType === 'UNCLASSIFIED_OFFICIAL_EVENT') {
    return {
      record,
      diagnostics: [{ code: 'TRUSTED_NEWS_REVIEW_EVENT_NOT_ESTABLISHED', evidenceId: record.id }],
    };
  }

  const retained = retainedExcerpts(text, company, maxRetained);
  const finalUrl = response.url || record.sourceUrl;
  return {
    record: {
      ...record,
      sourceUrl: finalUrl,
      rawText: retained,
      contentHash: contentHash({ sourceUrl: finalUrl, publishedAt: record.publishedAt, retained }),
      claimType: 'FACT',
      document: {
        status: 'REVIEWED_NEWS',
        fetchedAt: reviewedAt,
        contentType: type || 'text/html',
        byteLength,
        textLength: retained.length,
        reviewed: true,
        pages: [],
      },
      notes: `Trusted publisher article reviewed with bounded factual excerpts; full article text was not retained. Event classification: ${classification.eventType}.`,
    },
    diagnostics: [],
  };
}

export async function reviewTrustedNewsRecords(records, company, options = {}) {
  const limit = Math.max(0, Number(options.limit ?? 3));
  const reviewed = [];
  const diagnostics = [];
  for (let index = 0; index < records.length; index += 1) {
    if (index >= limit) {
      reviewed.push(records[index]);
      diagnostics.push({ code: 'TRUSTED_NEWS_REVIEW_DEFERRED_BY_LIMIT', evidenceId: records[index].id });
      continue;
    }
    const result = await reviewTrustedNewsRecord(records[index], company, options);
    reviewed.push(result.record);
    diagnostics.push(...(result.diagnostics || []));
  }
  return { records: reviewed, diagnostics };
}

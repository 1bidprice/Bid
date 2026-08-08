import { contentHash } from '../content-hash.js';

const DEFAULT_URL = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&output=atom&count=100';

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
  return decodeXml(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tagValue(block, tag) {
  const match = String(block || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? plainText(match[1]) : null;
}

function attrValue(block, tag, attr) {
  const match = String(block || '').match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, 'i'));
  return match ? decodeXml(match[1]).trim() : null;
}

function normalizedCik(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? digits.padStart(10, '0') : null;
}

function formFromEntry(block, title, category) {
  const summary = tagValue(block, 'summary') || '';
  const explicit = tagValue(block, 'filing-type') || tagValue(block, 'form-type');
  const value = explicit || category || title.match(/^([^\s-]+(?:\s[^\s-]+)?)/)?.[1] || summary.match(/Filed:\s*([^\s<]+)/i)?.[1] || '';
  return String(value).trim().toUpperCase();
}

function cikFromEntry(block, link, summary) {
  return normalizedCik(
    tagValue(block, 'cik') ||
    tagValue(block, 'company-cik') ||
    summary?.match(/CIK[:\s]+(\d{1,10})/i)?.[1] ||
    link?.match(/[?&]CIK=(\d+)/i)?.[1] ||
    link?.match(/data\/(\d+)\//i)?.[1],
  );
}

export function extractSecCurrentFilings(atom, options = {}) {
  const retrievedAt = new Date(options.retrievedAt || Date.now()).toISOString();
  const blocks = String(atom || '').match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  const records = [];
  const rejected = [];

  for (const block of blocks) {
    const title = tagValue(block, 'title') || '';
    const summary = tagValue(block, 'summary') || '';
    const link = attrValue(block, 'link', 'href') || tagValue(block, 'link');
    const category = attrValue(block, 'category', 'term');
    const cik = cikFromEntry(block, link, summary);
    const form = formFromEntry(block, title, category);
    const updatedRaw = tagValue(block, 'updated') || tagValue(block, 'filing-date') || retrievedAt;
    const updatedDate = new Date(updatedRaw);
    const publishedAt = Number.isNaN(updatedDate.getTime()) ? retrievedAt : updatedDate.toISOString();
    if (!cik || !form || !link) {
      rejected.push({ code: 'SEC_CURRENT_ENTRY_INCOMPLETE', cik, form: form || null, title, link: link || null });
      continue;
    }
    const hash = contentHash({ cik, form, title, link, publishedAt });
    records.push({
      id: `discovery:sec:${hash.slice(0, 24)}`,
      cik,
      form,
      title,
      summary,
      sourceUrl: link,
      publishedAt,
      retrievedAt,
      sourceType: 'REGULATORY_FILING_DISCOVERY',
      sourceName: 'SEC EDGAR Current Filings',
      reliabilityTier: 1,
      isPrimarySource: true,
      contentHash: hash,
    });
  }
  return { records, rejected };
}

export async function fetchSecCurrentFilings(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('SEC current filings adapter requires fetch');
  const userAgent = String(options.userAgent || '').trim();
  if (!userAgent) {
    return { records: [], diagnostics: [{ code: 'SEC_USER_AGENT_MISSING', adapter: 'sec-current-filings' }] };
  }
  const response = await fetchImpl(options.url || DEFAULT_URL, {
    headers: { Accept: 'application/atom+xml, application/xml, text/xml', 'User-Agent': userAgent },
  });
  if (!response.ok) {
    return { records: [], diagnostics: [{ code: 'SEC_CURRENT_FILINGS_HTTP_ERROR', status: response.status }] };
  }
  const atom = await response.text();
  const extracted = extractSecCurrentFilings(atom, { retrievedAt: options.retrievedAt });
  return {
    records: extracted.records,
    diagnostics: extracted.rejected.slice(0, 50),
    sourceUrl: options.url || DEFAULT_URL,
  };
}

import { extractEuronextAthensAnnouncements } from './euronext-athens-announcements.js';

export const EURONEXT_FINANCIAL_RESOLVER_VERSION = '2026-08-08.1';
const BASE_URL = 'https://athens.euronext.com';

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
  try { return new URL(String(value || ''), BASE_URL).toString(); } catch { return null; }
}

function periodFromText(value) {
  const text = plainText(value);
  const lower = text.toLowerCase();
  const explicitDate = text.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.]([0-3]?\d)\b/);
  const year = Number(explicitDate?.[1] || text.match(/\b(20\d{2})\b/)?.[1] || 0) || null;
  let months = null;
  let type = 'UNKNOWN';
  if (/q1|first quarter|1st quarter|three[- ]month|τριμην|α[΄']? τριμην/.test(lower)) { months = 3; type = 'INTERIM_3M'; }
  else if (/h1|first half|half[- ]year|six[- ]month|εξαμην|α[΄']? εξαμην/.test(lower)) { months = 6; type = 'INTERIM_6M'; }
  else if (/9m|nine[- ]month|εννεαμην|εννιαμην/.test(lower)) { months = 9; type = 'INTERIM_9M'; }
  else if (/annual|full[- ]year|year[- ]end|twelve[- ]month|ετησ|ετήσ|δωδεκαμην/.test(lower)) { months = 12; type = 'ANNUAL'; }
  const month = months === 3 ? 3 : months === 6 ? 6 : months === 9 ? 9 : months === 12 ? 12 : null;
  const periodEnd = explicitDate
    ? `${explicitDate[1]}-${String(explicitDate[2]).padStart(2, '0')}-${String(explicitDate[3]).padStart(2, '0')}`
    : year && month
      ? `${year}-${String(month).padStart(2, '0')}-${month === 3 ? '31' : month === 6 ? '30' : month === 9 ? '30' : '31'}`
      : null;
  return { year, months, type, periodEnd };
}

function financialTitleScore(value) {
  const text = plainText(value).toLowerCase();
  let score = 0;
  if (/financial statements|financial statement|χρηματοοικονομικ|οικονομικ[ήη] καταστασ|condensed consolidated/.test(text)) score += 60;
  if (/financial results|results for|quarterly results|half[- ]year results|annual results|αποτελεσματα|αποτελέσματα/.test(text)) score += 40;
  if (/interim|half[- ]year|quarter|annual|εξαμην|τριμην|ετησ|ετήσ/.test(text)) score += 20;
  if (/consolidated|ενοποιημ/.test(text)) score += 15;
  if (/preliminary|unaudited|προκαταρκτικ/.test(text)) score -= 5;
  if (/presentation|παρουσιασ|investor presentation|roadshow|factsheet|fact sheet/.test(text)) score -= 80;
  if (/remuneration|voting rights|share buyback|dividend|general meeting|board of directors/.test(text)) score -= 80;
  return score;
}

function attachmentCandidates(html, announcement) {
  const matches = [...String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const candidates = [];
  for (const match of matches) {
    const url = absoluteUrl(match[1]);
    if (!url || !/\.pdf(?:$|[?#])/i.test(url)) continue;
    const label = plainText(match[2]);
    const combined = `${announcement?.title || ''} ${label} ${decodeURIComponent(url).replace(/[_-]+/g, ' ')}`;
    const score = financialTitleScore(combined);
    if (score <= 0) continue;
    candidates.push({ url, label, score, combined });
  }
  return candidates.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
}

function candidateAuthority(candidate) {
  if (candidate.sourceChannel === 'FINANCIAL_DATA_INDEX') return 100;
  const score = financialTitleScore(`${candidate.title || ''} ${candidate.attachmentLabel || ''}`);
  return Math.max(50, Math.min(99, 55 + score));
}

function periodSortValue(candidate) {
  const date = candidate?.period?.periodEnd;
  if (date && /^20\d{2}-\d{2}-\d{2}$/.test(date)) return date;
  return String(candidate?.modifiedAt || '').slice(0, 10);
}

function sortCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    const period = periodSortValue(b).localeCompare(periodSortValue(a));
    if (period) return period;
    const authority = Number(b.authorityScore || 0) - Number(a.authorityScore || 0);
    if (authority) return authority;
    return String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || ''));
  });
}

function languageVariants(url, issuerId, suffix) {
  const urls = [];
  if (url) urls.push(url);
  if (issuerId) {
    urls.push(`${BASE_URL}/en/market-data/issuers/${encodeURIComponent(issuerId)}/${suffix}`);
    urls.push(`${BASE_URL}/el/market-data/issuers/${encodeURIComponent(issuerId)}/${suffix}?page=0`);
  }
  const expanded = [];
  for (const value of urls) {
    expanded.push(value);
    try {
      const parsed = new URL(value);
      if (parsed.hostname === 'athens.euronext.com') {
        if (parsed.pathname.includes('/en/')) {
          const el = new URL(parsed);
          el.pathname = el.pathname.replace('/en/', '/el/');
          if (!el.searchParams.has('page')) el.searchParams.set('page', '0');
          expanded.push(el.toString());
        } else if (parsed.pathname.includes('/el/')) {
          const en = new URL(parsed);
          en.pathname = en.pathname.replace('/el/', '/en/');
          en.searchParams.delete('page');
          expanded.push(en.toString());
        }
      }
    } catch {}
  }
  return [...new Set(expanded)];
}

async function fetchText(fetchImpl, url, userAgent) {
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'text/html,application/xhtml+xml', 'Cache-Control': 'no-cache', 'User-Agent': userAgent } });
    if (!response.ok) return { ok: false, status: response.status, url, text: '' };
    return { ok: true, status: response.status, url: response.url || url, text: await response.text() };
  } catch (error) {
    return { ok: false, status: null, url, text: '', error: String(error?.message || error) };
  }
}

export async function resolveEuronextAthensFinancialDocument(company, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Euronext financial resolver requires fetch');
  if (typeof options.extractFinancialDocuments !== 'function') throw new Error('Euronext financial resolver requires extractFinancialDocuments');
  const issuerId = String(company?.issuerId || '').trim();
  const userAgent = options.userAgent || 'Investor-Control-Market-Intelligence/1.5';
  const diagnostics = [];
  const candidates = [];

  const financialUrls = languageVariants(options.financialDataUrl, issuerId, 'financial-data');
  for (const indexUrl of financialUrls) {
    const fetched = await fetchText(fetchImpl, indexUrl, userAgent);
    if (!fetched.ok) {
      diagnostics.push({ code: 'EURONEXT_FINANCIAL_INDEX_FETCH_FAILED', companyId: company?.companyId, url: indexUrl, status: fetched.status, error: fetched.error || null });
      continue;
    }
    const docs = options.extractFinancialDocuments(fetched.text, company, options) || [];
    for (const doc of docs) {
      if (!doc?.identityVerified || !doc?.pdfUrl) continue;
      const candidate = {
        ...doc,
        indexUrl,
        sourceChannel: 'FINANCIAL_DATA_INDEX',
        issuerId,
        identityBinding: 'DOCUMENT_TITLE_AND_ISSUER_INDEX',
      };
      candidate.authorityScore = candidateAuthority(candidate);
      candidates.push(candidate);
    }
  }

  const announcementsUrl = company?.marketData?.euronextIssuerAnnouncementsUrl || null;
  const announcementUrls = languageVariants(announcementsUrl, issuerId, 'announcements');
  const seenDetails = new Set();
  for (const indexUrl of announcementUrls) {
    const fetched = await fetchText(fetchImpl, indexUrl, userAgent);
    if (!fetched.ok) {
      diagnostics.push({ code: 'EURONEXT_FINANCIAL_ANNOUNCEMENT_INDEX_FETCH_FAILED', companyId: company?.companyId, url: indexUrl, status: fetched.status, error: fetched.error || null });
      continue;
    }
    const announcements = extractEuronextAthensAnnouncements(fetched.text, {
      companyId: company?.companyId,
      retrievedAt: options.generatedAt || Date.now(),
      limit: Number(options.announcementLimit || 40),
    }).filter((record) => financialTitleScore(record.title) >= 35);

    for (const announcement of announcements.slice(0, Number(options.detailLimit || 12))) {
      if (seenDetails.has(announcement.sourceUrl)) continue;
      seenDetails.add(announcement.sourceUrl);
      const detail = await fetchText(fetchImpl, announcement.sourceUrl, userAgent);
      if (!detail.ok) {
        diagnostics.push({ code: 'EURONEXT_FINANCIAL_ANNOUNCEMENT_DETAIL_FETCH_FAILED', companyId: company?.companyId, url: announcement.sourceUrl, status: detail.status });
        continue;
      }
      const attachments = attachmentCandidates(detail.text, announcement);
      const attachment = attachments[0];
      if (!attachment) continue;
      const detailText = plainText(detail.text).slice(0, 20_000);
      const period = periodFromText(`${announcement.title} ${attachment.label} ${detailText}`);
      const candidate = {
        title: announcement.title,
        modifiedAt: announcement.publishedAt,
        pdfUrl: attachment.url,
        detailUrl: announcement.sourceUrl,
        indexUrl,
        identityScore: 100,
        identityVerified: true,
        identityBinding: 'EURONEXT_ISSUER_SCOPED_ANNOUNCEMENT',
        issuerId,
        period,
        sourceChannel: 'ISSUER_ANNOUNCEMENT_ATTACHMENT',
        attachmentLabel: attachment.label,
      };
      candidate.authorityScore = candidateAuthority(candidate);
      candidates.push(candidate);
    }
  }

  const uniqueByPdf = new Map();
  for (const candidate of candidates) {
    const existing = uniqueByPdf.get(candidate.pdfUrl);
    if (!existing || Number(candidate.authorityScore || 0) > Number(existing.authorityScore || 0)) uniqueByPdf.set(candidate.pdfUrl, candidate);
  }
  const ranked = sortCandidates([...uniqueByPdf.values()]);
  const document = ranked[0] || null;
  if (!document) diagnostics.push({ code: 'EURONEXT_FINANCIAL_DOCUMENT_RESOLUTION_FAILED', companyId: company?.companyId, issuerId, attemptedFinancialUrls: financialUrls, attemptedAnnouncementUrls: announcementUrls });
  else diagnostics.push({
    code: 'EURONEXT_FINANCIAL_DOCUMENT_RESOLVED',
    companyId: company?.companyId,
    sourceChannel: document.sourceChannel,
    periodEnd: document?.period?.periodEnd || null,
    authorityScore: document.authorityScore,
    identityBinding: document.identityBinding,
  });

  return {
    format: 'investor-control-euronext-financial-resolution',
    version: 1,
    policyVersion: EURONEXT_FINANCIAL_RESOLVER_VERSION,
    companyId: company?.companyId || null,
    issuerId: issuerId || null,
    document,
    candidates: ranked,
    diagnostics,
    invariant: 'ISSUER_SCOPED_REUSABLE_RESOLUTION_NO_TICKER_RULES',
  };
}

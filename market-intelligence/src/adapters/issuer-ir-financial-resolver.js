const COMMON_SECOND_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'com.au', 'net.au', 'co.jp', 'co.nz', 'com.br', 'com.sg', 'com.hk', 'co.za',
]);

const DISALLOWED_ISSUER_IR_ROOTS = new Set([
  'euronext.com',
  'sec.gov',
  'nyse.com',
  'nasdaq.com',
  'finnhub.io',
  'yahoo.com',
  'google.com',
  'bing.com',
]);

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

function organizationRoot(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (COMMON_SECOND_LEVEL_SUFFIXES.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

function rootFromUrl(value) {
  try { return organizationRoot(new URL(String(value)).hostname); } catch { return null; }
}

function canonicalIssuerRoot(company = {}) {
  const websiteRoot = rootFromUrl(company.website);
  const irRoot = rootFromUrl(company.investorRelationsUrl);
  if (!websiteRoot || !irRoot) return { root: null, reason: 'WEBSITE_AND_IR_REQUIRED' };
  if (websiteRoot !== irRoot) return { root: null, reason: 'WEBSITE_IR_ROOT_MISMATCH', websiteRoot, irRoot };
  if (DISALLOWED_ISSUER_IR_ROOTS.has(websiteRoot)) return { root: null, reason: 'NON_ISSUER_PLATFORM_ROOT', websiteRoot, irRoot };
  return { root: websiteRoot, reason: 'CANONICAL_ISSUER_ROOT_VERIFIED', websiteRoot, irRoot };
}

function withinCanonicalIssuerDomain(url, root) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    return Boolean(root) && (host === root || host.endsWith(`.${root}`));
  } catch {
    return false;
  }
}

function absoluteUrl(value, base) {
  try { return new URL(String(value || ''), base).toString(); } catch { return null; }
}

function anchors(html, base) {
  return [...String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ url: absoluteUrl(match[1], base), label: plainText(match[2]) }))
    .filter((item) => item.url);
}

function financialScore(value) {
  const text = plainText(value).toLowerCase();
  let score = 0;
  if (/condensed consolidated interim financial statements|consolidated interim financial statements|financial statements|financial statement/.test(text)) score += 85;
  if (/annual report|interim report|quarterly report|financial report/.test(text)) score += 65;
  if (/financial results|quarterly results|half[- ]year results|annual results|q[1-4]\s+20\d{2}\s+results/.test(text)) score += 45;
  if (/q[1-4]|first quarter|second quarter|third quarter|fourth quarter|first half|half[- ]year|annual|fy\s*20\d{2}|20\d{2}/.test(text)) score += 20;
  if (/ifrs|ias\s*34|consolidated/.test(text)) score += 25;
  if (/preliminary|trading update/.test(text)) score -= 30;
  if (/presentation|webcast|transcript|databook|data book|factsheet|fact sheet/.test(text)) score -= 55;
  if (/dividend|buyback|voting rights|general meeting|remuneration|sustainability/.test(text)) score -= 80;
  return score;
}

function periodFromText(value) {
  const text = plainText(value);
  const lower = text.toLowerCase();
  const year = Number(text.match(/\b(20\d{2})\b/)?.[1] || 0) || null;
  let months = null;
  let type = 'UNKNOWN';
  if (/q1|first quarter|three[- ]month/.test(lower)) { months = 3; type = 'INTERIM_3M'; }
  else if (/q2|first half|half[- ]year|six[- ]month/.test(lower)) { months = 6; type = 'INTERIM_6M'; }
  else if (/q3|nine[- ]month/.test(lower)) { months = 9; type = 'INTERIM_9M'; }
  else if (/q4|annual|full[- ]year|fy\s*20\d{2}|twelve[- ]month/.test(lower)) { months = 12; type = 'ANNUAL'; }
  const month = months === 3 ? 3 : months === 6 ? 6 : months === 9 ? 9 : months === 12 ? 12 : null;
  const periodEnd = year && month
    ? `${year}-${String(month).padStart(2, '0')}-${month === 3 ? '31' : month === 6 ? '30' : month === 9 ? '30' : '31'}`
    : null;
  return { year, months, type, periodEnd };
}

function textualPublishedAt(value) {
  const text = plainText(value);
  const months = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const match = text.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[3]), months[match[2].toLowerCase()], Number(match[1]), 12, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function fetchText(fetchImpl, url, userAgent) {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Cache-Control': 'no-cache',
        'User-Agent': userAgent,
      },
    });
    if (!response?.ok) return { ok: false, url, status: response?.status ?? null, text: '' };
    return { ok: true, url: response.url || url, status: response.status, text: await response.text() };
  } catch (error) {
    return { ok: false, url, status: null, text: '', error: String(error?.message || error) };
  }
}

function makePdfCandidate({ company, detailUrl, indexUrl, title, pdfUrl, attachmentLabel, pageText }) {
  const combined = `${title || ''} ${attachmentLabel || ''} ${pageText || ''}`;
  const period = periodFromText(combined);
  return {
    title: title || attachmentLabel || 'Issuer financial document',
    modifiedAt: textualPublishedAt(pageText) || null,
    pdfUrl,
    detailUrl: detailUrl || null,
    indexUrl: indexUrl || null,
    identityScore: 100,
    identityVerified: true,
    identityBinding: 'CANONICAL_ISSUER_IR_DOMAIN',
    issuerId: String(company?.issuerId || '').trim() || null,
    period,
    sourceChannel: 'ISSUER_IR_OFFICIAL',
    attachmentLabel: attachmentLabel || null,
    authorityScore: 98,
  };
}

export async function resolveCanonicalIssuerFinancialDocuments(company, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const irUrl = company?.investorRelationsUrl || null;
  const canonical = canonicalIssuerRoot(company);
  const root = canonical.root;
  const diagnostics = [];
  const candidates = [];
  const userAgent = options.userAgent || 'Investor-Control-Market-Intelligence/1.5';
  if (!irUrl || !root || !withinCanonicalIssuerDomain(irUrl, root)) {
    return {
      candidates,
      diagnostics: [{
        code: 'ISSUER_IR_FINANCIAL_CHANNEL_UNAVAILABLE',
        companyId: company?.companyId || null,
        reason: canonical.reason,
        websiteRoot: canonical.websiteRoot || null,
        irRoot: canonical.irRoot || null,
      }],
    };
  }

  const index = await fetchText(fetchImpl, irUrl, userAgent);
  if (!index.ok) {
    return { candidates, diagnostics: [{ code: 'ISSUER_IR_FINANCIAL_INDEX_FETCH_FAILED', companyId: company?.companyId || null, url: irUrl, status: index.status, error: index.error || null }] };
  }

  const indexLinks = anchors(index.text, index.url)
    .filter((item) => withinCanonicalIssuerDomain(item.url, root))
    .map((item) => ({ ...item, score: financialScore(`${item.label} ${item.url}`) }))
    .filter((item) => item.score >= Number(options.minimumIssuerFinancialLinkScore || 35))
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));

  const seen = new Set();
  for (const link of indexLinks.slice(0, Number(options.issuerFinancialDetailLimit || 20))) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    if (/\.pdf(?:$|[?#])/i.test(link.url)) {
      candidates.push(makePdfCandidate({ company, indexUrl: irUrl, detailUrl: null, title: link.label, pdfUrl: link.url, attachmentLabel: link.label, pageText: link.label }));
      continue;
    }

    const detail = await fetchText(fetchImpl, link.url, userAgent);
    if (!detail.ok) {
      diagnostics.push({ code: 'ISSUER_IR_FINANCIAL_DETAIL_FETCH_FAILED', companyId: company?.companyId || null, url: link.url, status: detail.status });
      continue;
    }
    const detailText = plainText(detail.text).slice(0, 30_000);
    const detailScore = financialScore(`${link.label} ${detailText.slice(0, 2_500)}`);
    if (detailScore < Number(options.minimumIssuerFinancialDetailScore || 55)) continue;

    const pdfLinks = anchors(detail.text, detail.url)
      .filter((item) => /\.pdf(?:$|[?#])/i.test(item.url))
      .filter((item) => withinCanonicalIssuerDomain(item.url, root))
      .map((item) => ({ ...item, score: financialScore(`${link.label} ${item.label} ${detailText.slice(0, 2_500)}`) }))
      .filter((item) => item.score >= Number(options.minimumIssuerFinancialPdfScore || 65))
      .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));

    for (const pdf of pdfLinks.slice(0, Number(options.issuerFinancialPdfLimit || 4))) {
      candidates.push(makePdfCandidate({
        company,
        indexUrl: irUrl,
        detailUrl: link.url,
        title: link.label,
        pdfUrl: pdf.url,
        attachmentLabel: pdf.label,
        pageText: detailText,
      }));
    }
  }

  const unique = new Map();
  for (const candidate of candidates) if (!unique.has(candidate.pdfUrl)) unique.set(candidate.pdfUrl, candidate);
  const resolved = [...unique.values()];
  diagnostics.push({
    code: resolved.length ? 'ISSUER_IR_FINANCIAL_CANDIDATES_DISCOVERED' : 'ISSUER_IR_FINANCIAL_DOCUMENT_NOT_FOUND',
    companyId: company?.companyId || null,
    investorRelationsUrl: irUrl,
    canonicalRoot: root,
    candidateCount: resolved.length,
  });
  return { candidates: resolved, diagnostics };
}

export const ISSUER_IR_FINANCIAL_RESOLVER_VERSION = '2026-08-08.2';

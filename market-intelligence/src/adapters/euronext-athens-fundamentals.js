import { extractPdfText } from '../pdf-extractor.js';

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
  try {
    return new URL(String(value || ''), BASE_URL).toString();
  } catch {
    return null;
  }
}

function normalizedIdentity(value) {
  return plainText(value)
    .toUpperCase()
    .replace(/\b(SOCIETE ANONYME|S\.A\.|SA|PLC|AG|HOLDINGS?|CORPORATION|CORP\.?|INC\.?)\b/g, ' ')
    .replace(/[^A-Z0-9Α-Ω]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function identityTokens(value) {
  return normalizedIdentity(value).split(' ').filter((token) => token.length >= 3);
}

function identityScore(title, company) {
  const targetNames = [company?.displayName, company?.legalName, ...(company?.aliases || [])]
    .filter(Boolean)
    .map(normalizedIdentity)
    .filter(Boolean);
  const normalizedTitle = normalizedIdentity(title);
  if (!normalizedTitle || !targetNames.length) return 0;
  if (targetNames.some((name) => normalizedTitle.includes(name) || name.includes(normalizedTitle))) return 100;
  let best = 0;
  for (const name of targetNames) {
    const tokens = identityTokens(name);
    if (!tokens.length) continue;
    const matched = tokens.filter((token) => normalizedTitle.includes(token)).length;
    best = Math.max(best, Math.round((matched / tokens.length) * 100));
  }
  return best;
}

function parseAthensDate(value) {
  const match = plainText(value).match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const [, day, month, year, hour = '12', minute = '00'] = match;
  const result = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 3, Number(minute)));
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}

function rowAnchors(row) {
  return [...String(row || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: absoluteUrl(match[1]), text: plainText(match[2]) }))
    .filter((item) => item.href);
}

function periodFromTitle(title) {
  const text = plainText(title);
  const year = Number(text.match(/\((20\d{2})[,/]/)?.[1] || text.match(/\b(20\d{2})\b/)?.[1] || 0) || null;
  const lower = text.toLowerCase();
  let months = null;
  let type = 'UNKNOWN';
  if (/three[- ]month|quarter|τριμην/i.test(lower)) { months = 3; type = 'INTERIM_3M'; }
  else if (/six[- ]month|half[- ]year|εξαμην/i.test(lower)) { months = 6; type = 'INTERIM_6M'; }
  else if (/nine[- ]month|εννεαμην|εννιαμην/i.test(lower)) { months = 9; type = 'INTERIM_9M'; }
  else if (/year statement|annual|twelve[- ]month|ετήσ|δωδεκαμην/i.test(lower)) { months = 12; type = 'ANNUAL'; }
  const month = months === 3 ? 3 : months === 6 ? 6 : months === 9 ? 9 : months === 12 ? 12 : null;
  const periodEnd = year && month ? `${year}-${String(month).padStart(2, '0')}-${month === 3 ? '31' : month === 6 ? '30' : month === 9 ? '30' : '31'}` : null;
  return { year, months, type, periodEnd };
}

export function extractAthensFinancialDocuments(html, company, options = {}) {
  const rows = String(html || '').match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  const records = [];
  for (const row of rows) {
    const anchors = rowAnchors(row);
    const pdf = anchors.find((item) => /\.pdf(?:$|[?#])/i.test(item.href) || /downloadpdf/i.test(item.text));
    if (!pdf) continue;
    const cells = (row.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) || []).map(plainText);
    const titleAnchor = anchors.find((item) => item !== pdf && !/downloadpdf/i.test(item.text));
    const title = titleAnchor?.text || cells[0] || pdf.text || '';
    const modifiedAt = cells.map(parseAthensDate).find(Boolean) || null;
    const score = identityScore(title, company);
    const period = periodFromTitle(title);
    records.push({
      title,
      modifiedAt,
      pdfUrl: pdf.href,
      detailUrl: titleAnchor?.href || null,
      identityScore: score,
      identityVerified: score >= Number(options.minimumIdentityScore ?? 60),
      period,
    });
  }
  return records.sort((a, b) => String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || '')));
}

function parseFinancialNumber(token) {
  let raw = String(token || '').trim();
  if (!raw || raw === '-' || raw === '—') return null;
  const negative = /^\(.*\)$/.test(raw) || /^-/.test(raw);
  raw = raw.replace(/[()€$£\s]/g, '').replace(/^[-+]/, '');
  if (!raw || !/[0-9]/.test(raw)) return null;
  if (raw.includes(',') && raw.includes('.')) {
    const decimalComma = raw.lastIndexOf(',') > raw.lastIndexOf('.');
    raw = decimalComma ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if (raw.includes(',')) {
    const parts = raw.split(',');
    raw = parts.length === 2 && parts[1].length <= 4 ? `${parts[0].replace(/\./g, '')}.${parts[1]}` : raw.replace(/,/g, '');
  } else if ((raw.match(/\./g) || []).length > 1 || /^\d{1,3}(?:\.\d{3})+$/.test(raw)) {
    raw = raw.replace(/\./g, '');
  }
  const value = Number(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

function numericTokens(line) {
  const matches = String(line || '').match(/\(?[-+]?\d[\d.,]*\)?/g) || [];
  return matches.map((raw) => ({ raw, value: parseFinancialNumber(raw) })).filter((item) => item.value !== null);
}

function scaleFromText(text) {
  const head = String(text || '').slice(0, 9000).toLowerCase();
  if (/(amounts?|figures?).{0,20}(€|eur|euro).{0,12}(million|mn)|in millions of euro|€\s*mn/.test(head)) return 1_000_000;
  if (/(amounts?|figures?).{0,20}(€|eur|euro).{0,12}(thousand|000)|in thousands of euro|€\s*['’]?000/.test(head)) return 1_000;
  return 1;
}

function normalizeLine(value) {
  return plainText(value).toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
}

function provenanceForLine(pages, line) {
  const needle = String(line || '').trim();
  if (!needle) return null;
  const index = pages.findIndex((page) => String(page || '').includes(needle));
  return index >= 0 ? { pageNumber: index + 1, extractedLine: needle } : { pageNumber: null, extractedLine: needle };
}

function findMetricRow(pages, labels, options = {}) {
  const maxPages = Math.min(pages.length, Number(options.maxPages || 10));
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const lines = String(pages[pageIndex] || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const normalized = normalizeLine(line);
      const label = labels.find((candidate) => normalized.includes(candidate));
      if (!label) continue;
      if (options.exclude?.some((candidate) => normalized.includes(candidate))) continue;
      const numbers = numericTokens(line);
      const needed = Number(options.minimumNumbers || 2);
      if (numbers.length < needed) continue;
      const selected = numbers.slice(-Math.max(needed, 2));
      return {
        label,
        line,
        pageNumber: pageIndex + 1,
        values: selected.map((item) => item.value),
      };
    }
  }
  return null;
}

function metricPair(row, scale, period, concept) {
  if (!row?.values?.length || !period?.year) return [];
  const values = row.values.slice(-2).map((value) => value * scale);
  const currentEnd = period.periodEnd;
  const previousEnd = currentEnd ? `${period.year - 1}${currentEnd.slice(4)}` : null;
  const make = (value, end, fiscalYear, comparative) => ({
    concept,
    unit: 'EUR',
    value,
    start: null,
    end,
    filed: null,
    accession: null,
    form: 'EURONEXT_ATHENS_FINANCIAL_STATEMENT',
    fiscalYear,
    fiscalPeriod: period.type,
    frame: null,
    comparative,
    provenance: { pageNumber: row.pageNumber, extractedLine: row.line, sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT' },
  });
  return [make(values[0], currentEnd, period.year, false), values.length > 1 ? make(values[1], previousEnd, period.year - 1, true) : null].filter(Boolean);
}

function instantMetric(row, scale, period, concept) {
  const pair = metricPair(row, scale, period, concept);
  return pair[0] || null;
}

function ratioPct(a, b) {
  const x = Number(a?.value);
  const y = Number(b?.value);
  return Number.isFinite(x) && Number.isFinite(y) && y !== 0 ? Number(((x / y) * 100).toFixed(2)) : null;
}

function growthPct(entries) {
  if (!entries?.[0] || !entries?.[1] || Number(entries[1].value) === 0) return null;
  return Number((((Number(entries[0].value) - Number(entries[1].value)) / Math.abs(Number(entries[1].value))) * 100).toFixed(2));
}

function derivedShares(netIncome, epsRow, period) {
  const eps = epsRow?.values?.slice(-2)?.[0];
  const income = netIncome?.[0]?.value;
  if (!Number.isFinite(Number(eps)) || Number(eps) === 0 || !Number.isFinite(Number(income))) return [];
  const shares = Number(income) / Number(eps);
  if (!Number.isFinite(shares) || shares <= 0) return [];
  return [{
    concept: 'DerivedDilutedSharesFromReportedEPS',
    unit: 'shares',
    value: Math.round(shares),
    start: null,
    end: period.periodEnd,
    filed: null,
    accession: null,
    form: 'EURONEXT_ATHENS_FINANCIAL_STATEMENT',
    fiscalYear: period.year,
    fiscalPeriod: period.type,
    frame: null,
    comparative: false,
    derived: true,
    provenance: { pageNumber: epsRow.pageNumber, extractedLine: epsRow.line, derivation: 'netIncome / reported basic-and-diluted EPS' },
  }];
}

export function buildAthensFundamentalSnapshotFromText(textInput, document, company, options = {}) {
  const pages = Array.isArray(options.pages) && options.pages.length
    ? options.pages.map((page) => typeof page === 'string' ? page : page?.text || '').filter(Boolean)
    : String(textInput || '').split('\f').filter(Boolean);
  const text = pages.length ? pages.join('\n\n') : String(textInput || '');
  const period = document?.period || periodFromTitle(document?.title || '');
  const scale = scaleFromText(text);

  const revenueRow = findMetricRow(pages, ['sales', 'revenue', 'turnover'], { exclude: ['cost of sales', 'revenue reserve', 'revenue recognition'] });
  const netIncomeRow = findMetricRow(pages, ['net profit for the period', 'profit for the period', 'profit after tax', 'profit after taxes', 'net income'], { exclude: ['before tax', 'before taxes'] });
  const operatingCashFlowRow = findMetricRow(pages, ['cash flow from operating activities', 'net cash from operating activities', 'net cash generated from operating activities']);
  const capexRow = findMetricRow(pages, ['purchase of tangible and intangible assets', 'purchase of property, plant and equipment', 'payments to acquire property plant and equipment', 'capital expenditure']);
  const cashRow = findMetricRow(pages, ['cash and cash equivalents', 'cash & cash equivalents'], { exclude: ['beginning of period', 'end of period', 'change in'] });
  const assetsRow = findMetricRow(pages, ['total assets']);
  const liabilitiesRow = findMetricRow(pages, ['total liabilities'], { exclude: ['equity and liabilities'] });
  const equityRow = findMetricRow(pages, ['total equity', 'total shareholders equity', 'shareholders equity'], { exclude: ['equity and liabilities'] });
  const directSharesRow = findMetricRow(pages, ['weighted average number of diluted shares', 'weighted average number of shares', 'average number of shares'], { minimumNumbers: 1 });
  const epsRow = findMetricRow(pages, ['basic and diluted', 'basic & diluted', 'diluted earnings per share'], { minimumNumbers: 2 });

  const revenue = metricPair(revenueRow, scale, period, 'Revenue');
  const netIncome = metricPair(netIncomeRow, scale, period, 'NetIncome');
  const operatingCashFlow = metricPair(operatingCashFlowRow, scale, period, 'OperatingCashFlow');
  const capitalExpenditure = metricPair(capexRow, scale, period, 'CapitalExpenditure');
  let dilutedShares = directSharesRow
    ? metricPair(directSharesRow, 1, period, 'DilutedShares')
    : derivedShares(netIncome, epsRow, period);
  dilutedShares = dilutedShares.filter((entry) => Number(entry.value) > 1_000);

  const cash = instantMetric(cashRow, scale, period, 'CashAndCashEquivalents');
  const assets = instantMetric(assetsRow, scale, period, 'Assets');
  const liabilities = instantMetric(liabilitiesRow, scale, period, 'Liabilities');
  const equity = instantMetric(equityRow, scale, period, 'Equity');
  const freeCashFlow = operatingCashFlow[0] && capitalExpenditure[0]
    ? Number(operatingCashFlow[0].value) - Math.abs(Number(capitalExpenditure[0].value))
    : null;

  const required = [revenue[0], netIncome[0], cash, assets, liabilities, equity, dilutedShares[0]];
  const available = required.filter(Boolean).length;
  const sector = String(company?.sector || '').toLowerCase();
  const bankLike = /financial|bank|insurance/.test(sector) || /bank/i.test(String(company?.displayName || company?.legalName || ''));
  const realEstateLike = /real estate|reic|reit/.test(sector) || /real estate|reic|reit/i.test(String(company?.displayName || company?.legalName || ''));
  const genericModelEligible = !bankLike && !realEstateLike;
  const extractionReady = available >= 6 && Boolean(revenue[0] && netIncome[0] && dilutedShares[0]);

  return {
    format: 'investor-control-euronext-athens-fundamentals',
    version: 1,
    companyId: company?.companyId || null,
    companyName: company?.displayName || company?.legalName || null,
    generatedAt: new Date(options.generatedAt || Date.now()).toISOString(),
    sourceUrl: document?.pdfUrl || null,
    sourceDocument: {
      title: document?.title || null,
      detailUrl: document?.detailUrl || null,
      modifiedAt: document?.modifiedAt || null,
      identityScore: document?.identityScore ?? null,
      identityVerified: document?.identityVerified === true,
      period,
      extractionStatus: options.extractionStatus || null,
      pageCount: pages.length || null,
    },
    reporting: {
      periodType: period?.type || 'UNKNOWN',
      periodMonths: period?.months || null,
      periodEnd: period?.periodEnd || null,
      currency: 'EUR',
      scale,
      annualComparable: Number(period?.months) === 12,
      genericModelEligible,
      bankLike,
      realEstateLike,
    },
    annual: {
      revenue,
      netIncome,
      operatingCashFlow,
      capitalExpenditure,
      dilutedShares,
    },
    instant: { cash, assets, liabilities, equity },
    metrics: {
      annualRevenueGrowthPct: growthPct(revenue),
      annualNetMarginPct: ratioPct(netIncome[0], revenue[0]),
      dilutedSharesChangePct: dilutedShares.length > 1 ? growthPct(dilutedShares) : null,
      latestFreeCashFlow: freeCashFlow,
      latestAnnualFreeCashFlowUSD: null,
    },
    coverage: {
      available,
      expected: required.length,
      score: Number(((available / required.length) * 100).toFixed(2)),
    },
    metricsReady: Boolean(document?.identityVerified && extractionReady && genericModelEligible),
    quality: {
      identityVerified: document?.identityVerified === true,
      extractionReady,
      genericModelEligible,
      flowDataAnnualComparable: Number(period?.months) === 12,
      derivedShareCount: dilutedShares.some((entry) => entry.derived === true),
      sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT',
    },
  };
}

function financialDataUrl(company) {
  if (company?.marketData?.euronextFinancialDataUrl) return company.marketData.euronextFinancialDataUrl;
  const issuerId = String(company?.issuerId || '').trim();
  return issuerId ? `${BASE_URL}/en/market-data/issuers/${encodeURIComponent(issuerId)}/financial-data` : null;
}

export async function fetchEuronextAthensFundamentals(company, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Euronext Athens fundamentals adapter requires fetch');
  const pageUrl = financialDataUrl(company);
  if (!pageUrl) return { snapshot: null, diagnostics: [{ code: 'ATHENS_FINANCIAL_ISSUER_ID_MISSING', companyId: company?.companyId }] };

  const pageResponse = await fetchImpl(pageUrl, {
    headers: { Accept: 'text/html,application/xhtml+xml', 'Cache-Control': 'no-cache', 'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/1.0' },
  });
  if (!pageResponse.ok) return { snapshot: null, diagnostics: [{ code: 'ATHENS_FINANCIAL_INDEX_HTTP_ERROR', companyId: company?.companyId, status: pageResponse.status }] };
  const html = await pageResponse.text();
  const documents = extractAthensFinancialDocuments(html, company, options);
  const verified = documents.filter((item) => item.identityVerified && item.pdfUrl);
  if (!verified.length) {
    return {
      snapshot: null,
      diagnostics: [{
        code: documents.length ? 'ATHENS_FINANCIAL_IDENTITY_NOT_VERIFIED' : 'ATHENS_FINANCIAL_DOCUMENT_NOT_FOUND',
        companyId: company?.companyId,
        pageUrl,
        candidateCount: documents.length,
      }],
    };
  }

  const document = verified[0];
  const pdfResponse = await fetchImpl(document.pdfUrl, {
    headers: { Accept: 'application/pdf', 'Cache-Control': 'no-cache', 'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/1.0' },
  });
  if (!pdfResponse.ok) return { snapshot: null, diagnostics: [{ code: 'ATHENS_FINANCIAL_PDF_HTTP_ERROR', companyId: company?.companyId, status: pdfResponse.status }] };
  const buffer = Buffer.from(await pdfResponse.arrayBuffer());
  const pdfExtractor = options.pdfExtractor || extractPdfText;
  const extracted = await pdfExtractor(buffer, {
    maxBytes: options.maxBytes,
    minReviewedText: options.minReviewedText,
    timeoutMs: options.timeoutMs,
  });
  if (!extracted?.reviewed) {
    return {
      snapshot: null,
      diagnostics: [{ code: 'ATHENS_FINANCIAL_PDF_NOT_REVIEWED', companyId: company?.companyId, status: extracted?.status || null }, ...(extracted?.diagnostics || [])],
    };
  }

  const pageTexts = Array.isArray(extracted.pages) && extracted.pages.length
    ? extracted.pages.map((page) => extracted.text.slice(page.textStart, page.textEnd))
    : [];
  const snapshot = buildAthensFundamentalSnapshotFromText(extracted.text, document, company, {
    generatedAt: options.generatedAt,
    pages: pageTexts,
    extractionStatus: extracted.status,
  });
  const diagnostics = [];
  if (!snapshot.quality.identityVerified) diagnostics.push({ code: 'ATHENS_FINANCIAL_IDENTITY_NOT_VERIFIED', companyId: company?.companyId });
  if (!snapshot.quality.extractionReady) diagnostics.push({ code: 'ATHENS_FINANCIAL_METRICS_INCOMPLETE', companyId: company?.companyId, coverage: snapshot.coverage.score });
  if (!snapshot.quality.genericModelEligible) diagnostics.push({ code: 'ATHENS_FINANCIAL_SECTOR_MODEL_REQUIRED', companyId: company?.companyId });
  if (!snapshot.reporting.annualComparable) diagnostics.push({ code: 'ATHENS_FINANCIAL_INTERIM_FLOW_BASIS', companyId: company?.companyId, periodMonths: snapshot.reporting.periodMonths });
  return { snapshot, diagnostics };
}

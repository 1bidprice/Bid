import { extractPdfText } from '../pdf-extractor.js';
import { classifyFundamentalModel } from '../fundamental-model.js';
import { resolveEuronextAthensFinancialDocument } from './euronext-athens-financial-resolver.js';
import { buildAthensBankPassport } from '../athens-bank-passport.js';

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

function normalizePdfGlyphs(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[Ɵ]/g, 'ti')
    .replace(/[ﬀ]/g, 'ff')
    .replace(/[ﬁ]/g, 'fi')
    .replace(/[ﬂ]/g, 'fl')
    .replace(/[ﬃ]/g, 'ffi')
    .replace(/[ﬄ]/g, 'ffl')
    .replace(/[\u00ad\u200b\u200c\u200d\u2060\ufeff]/g, '')
    // Some embedded PDF fonts drop the same 'ti' glyph entirely. Repair only
    // proven accounting vocabulary so canonical row/context matching remains
    // deterministic without guessing arbitrary missing characters.
    .replace(/\bposi\s+on\b/gi, 'position')
    .replace(/\bacquisi\s+on\b/gi, 'acquisition')
    .replace(/[‐‑‒–—−]/g, '-');
}

function normalizedScaleLine(value) {
  return normalizePdfGlyphs(String(value || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function unitScaleDeclaration(line) {
  const text = normalizedScaleLine(line);
  if (!text) return null;
  const explicitPatterns = [
    /^(?:\(?\s*)?(?:amounts?|figures?)\s+(?:are\s+)?(?:presented\s+|expressed\s+|stated\s+)?in\s+(?:€\s*)?(?:(?:eur|euro|euros)\s+)?(thousand|thousands|000|million|millions|mn)\b/,
    /^(?:\(?\s*)?(?:amounts?|figures?)\s+(?:are\s+)?(?:presented\s+|expressed\s+|stated\s+)?in\s+(thousand|thousands|million|millions)\s+of\s+(?:eur|euro|euros)\b/,
    /^(?:\(?\s*)?in\s+(thousand|thousands|million|millions)\s+of\s+(?:eur|euro|euros)\b/,
    /^(?:\(?\s*)?(?:amounts?|figures?)\s+(?:are\s+)?(?:presented\s+|expressed\s+|stated\s+)?in\s+(?:€|eur|euro|euros)\s*(000|mn)\b/,
  ];
  for (const pattern of explicitPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const unit = String(match[1] || '').toLowerCase();
    return /million|mn/.test(unit) ? 1_000_000 : 1_000;
  }

  // Reviewed IFRS packs often place the unit declaration in a repeated
  // statement title/footer rather than on a standalone "Amounts in ..." row.
  // Accept that suffix only when the same line is structurally tied to the
  // financial statements; narrative sentences containing monetary amounts do
  // not qualify as a document-wide scale declaration.
  const authoritativeStatementLine = /(?:financial statements?|statement of (?:comprehensive income|financial position|cash flows?)|income statement|balance sheet|cash flow statement)/.test(text);
  if (authoritativeStatementLine) {
    const suffix = text.match(/\(\s*in\s+(thousand|thousands|million|millions)\s+of\s+(?:eur|euro|euros)\s*\)/);
    if (suffix) return /million/.test(String(suffix[1] || '')) ? 1_000_000 : 1_000;
  }
  return null;
}

function scaleDeclarations(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line, lineIndex) => ({ lineIndex, scale: unitScaleDeclaration(line), line: normalizedScaleLine(line) }))
    .filter((entry) => entry.scale !== null);
}

function primaryStatementHeadingLine(value) {
  const lines = String(value || '').split(/\r?\n/).map(normalizedScaleLine).filter(Boolean);
  return lines.find((line) => {
    const match = line.match(/^(?:(?:condensed|consolidated)\s+){0,3}(?:income statement|statement of comprehensive income|statement of financial position|balance sheet|statement of cash flows?|cash flow statement)\b(.*)$/);
    if (!match) return false;
    const tail = String(match[1] || '').trim();
    return !/^(?:commentary|remarks|review|analysis|overview|discussion)\b/.test(tail);
  }) || null;
}

function scaleFromText(text, pages = []) {
  const pageList = Array.isArray(pages) ? pages : [];
  const statementPageScales = [];
  for (const page of pageList) {
    if (!primaryStatementHeadingLine(page)) continue;
    const declarations = scaleDeclarations(page);
    if (declarations.length) statementPageScales.push(declarations[0].scale);
  }
  const uniqueStatementScales = [...new Set(statementPageScales)];
  if (uniqueStatementScales.length === 1) return uniqueStatementScales[0];
  if (uniqueStatementScales.length > 1) return 1;

  // Some reports declare units once on a cover/header page and omit them from
  // each statement page. Use the first explicit document declaration only;
  // later APM/commentary unit references must never override it.
  for (const page of pageList) {
    const declarations = scaleDeclarations(page);
    if (declarations.length) return declarations[0].scale;
  }
  const fullDeclarations = scaleDeclarations(text);
  return fullDeclarations[0]?.scale || 1;
}

function normalizeLine(value) {
  return normalizePdfGlyphs(plainText(value)).toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
}

function provenanceForLine(pages, line) {
  const needle = String(line || '').trim();
  if (!needle) return null;
  const index = pages.findIndex((page) => String(page || '').includes(needle));
  return index >= 0 ? { pageNumber: index + 1, extractedLine: needle } : { pageNumber: null, extractedLine: needle };
}

function looksLikeTableOfContentsLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (/table of contents|contents/.test(lower) && raw.length < 160) return true;
  const dotLeader = /\.{4,}|…{3,}/.test(raw);
  const trailingPageNumber = /\s\d{1,3}\s*$/.test(raw);
  return dotLeader && trailingPageNumber;
}

function looksLikeNarrativeMetricLine(line) {
  const raw = String(line || '').trim();
  const lower = raw.toLowerCase();
  if (!raw) return false;
  // Financial statement rows are label/value structures. Narrative prose that
  // happens to contain the same label must not be promoted into audited facts.
  return /\b(amounted to|stood at|reached|was formed at|were formed at|compared (?:with|to)|versus|of which|representing|presenting|increased (?:to|by)|decreased (?:to|by)|rose (?:to|by)|fell (?:to|by))\b/i.test(lower);
}

function metricLineScale(line) {
  const text = String(line || '').toLowerCase();
  if (/\b(million|millions|mn|mio)\b|εκατ\.?/.test(text)) return 1_000_000;
  if (/\b(thousand|thousands)\b|χιλ\.?/.test(text)) return 1_000;
  return 1;
}

function scrubMetricLine(line) {
  return String(line || '')
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, ' ')
    .replace(/\b\d+(?:st|nd|rd|th)\b/gi, ' ')
    .replace(/^\s*\d+(?:\.\d+)+\s+(?=[A-Za-zΑ-Ω])/iu, ' ')
    .replace(/\b(?:note|σημ(?:είωση|ειωση)?\.?)\s*[A-ZΑ-Ω]?\d+(?:\.\d+)*\b/giu, ' ')
    .replace(/\b[A-ZΑ-Ω]\.\d+(?:\.\d+)*\b/gu, ' ');
}

function parseStatementNumber(token, options = {}) {
  let raw = String(token || '').trim();
  if (!raw || raw === '-' || raw === '—') return null;
  const negative = /^\(.*\)$/.test(raw) || /^-/.test(raw);
  raw = raw.replace(/[()€$£\s]/g, '').replace(/^[-+]/, '');
  if (!raw || !/[0-9]/.test(raw)) return null;

  const decimalMode = options.decimalMode === true;
  const commaCount = (raw.match(/,/g) || []).length;
  const dotCount = (raw.match(/\./g) || []).length;

  if (decimalMode) {
    if (commaCount && dotCount) {
      const decimalComma = raw.lastIndexOf(',') > raw.lastIndexOf('.');
      raw = decimalComma ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    } else if (commaCount) {
      raw = raw.replace(/,/g, '.');
    }
  } else if (commaCount && dotCount) {
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    const lastSeparator = Math.max(lastComma, lastDot);
    const suffixLength = raw.length - lastSeparator - 1;
    if (suffixLength === 3) {
      raw = raw.replace(/[.,]/g, '');
    } else if (lastComma > lastDot) {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else {
      raw = raw.replace(/,/g, '');
    }
  } else if (commaCount) {
    const parts = raw.split(',');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0] !== '0')) raw = raw.replace(/,/g, '');
    else raw = raw.replace(',', '.');
  } else if (dotCount) {
    const parts = raw.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0] !== '0')) raw = raw.replace(/\./g, '');
  }

  const value = Number(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

function financialNumericTokens(line, options = {}) {
  const matches = String(scrubMetricLine(line) || '').match(/\(?[-+]?\d[\d.,]*\)?/g) || [];
  return matches.map((raw) => ({ raw, value: parseStatementNumber(raw, options) })).filter((item) => {
    if (item.value === null) return false;
    const value = Number(item.value);
    const yearLike = Number.isInteger(value) && value >= 1900 && value <= 2100 && /^[-+]?\d{4}$/.test(String(item.raw || '').trim());
    return !yearLike;
  });
}

function metricRowLabel(normalized, labels = []) {
  let best = null;
  for (const candidate of labels) {
    const label = normalizeLine(candidate);
    if (!label) continue;
    const index = normalized.indexOf(label);
    if (index < 0) continue;
    const prefix = normalized.slice(0, index).trim();
    let score = 0;
    if (index === 0) score = 100;
    else if (prefix.length <= 12 && /^[\s·•*\-–—:().]+$/u.test(prefix)) score = 90;
    else if (prefix.length <= 16 && /^(?:(?:note|σημ(?:ειωση)?)\s*)?(?:[a-zα-ω]?\d+(?:[.]\d+)*|[a-zα-ω][.]\d+(?:[.]\d+)*)[ .:()-]*$/i.test(prefix)) score = 75;
    if (!score) continue;
    if (!best || score > best.score || (score === best.score && label.length > best.label.length)) best = { label: candidate, normalizedLabel: label, score };
  }
  return best;
}

const STATEMENT_CONTEXT_PATTERNS = Object.freeze({
  INCOME_STATEMENT: [
    /statement of (?:comprehensive income|profit (?:or|and) loss|income)/i,
    /(?:consolidated|condensed|interim) (?:statement of )?(?:comprehensive income|profit (?:or|and) loss|income statement)/i,
    /income statement/i,
    /κατάσταση (?:συνολικού εισοδήματος|αποτελεσμάτων)/i,
    /αποτελέσματα (?:χρήσης|περιόδου)/i,
  ],
  BALANCE_SHEET: [
    /statement of financial position/i,
    /^\s*(?:condensed\s+)?balance sheet\b/im,
    /κατάσταση (?:χρηματοοικονομικής|οικονομικής) θέσης/i,
    /ισολογισμ/i,
  ],
  CASH_FLOW: [
    /statement of cash flows?/i,
    /cash flows? statement/i,
    /κατάσταση ταμειακών ροών/i,
    /ταμειακές ροές/i,
  ],
});

function statementContextScore(pages, pageIndex, contexts = []) {
  if (!contexts.length) return 1;
  // Context recognition must use the exact same canonical text path as metric
  // row labels. This removes soft/zero-width PDF artifacts and repairs the
  // bounded accounting glyph-loss cases before applying statement patterns.
  const current = normalizeLine(String(pages[pageIndex] || ''));
  const previous = pageIndex > 0 ? normalizeLine(String(pages[pageIndex - 1] || '')) : '';
  let best = 0;
  for (const context of contexts) {
    if (context === 'SHARE_COUNT_NOTE') {
      const shareDisclosure = /(?:earnings per share|weighted average number of (?:ordinary|diluted )?shares)/i;
      if (shareDisclosure.test(current)) best = Math.max(best, 100);
      else if (previous && shareDisclosure.test(previous)) best = Math.max(best, 60);
      continue;
    }
    const patterns = STATEMENT_CONTEXT_PATTERNS[context] || [];
    if (patterns.some((pattern) => pattern.test(current))) best = Math.max(best, 100);
    else if (previous && patterns.some((pattern) => pattern.test(previous))) best = Math.max(best, 60);
  }
  return best;
}

function metricLabelTailAllowed(normalized, labelMatch, options = {}) {
  if (!labelMatch?.normalizedLabel) return false;
  const start = normalized.indexOf(labelMatch.normalizedLabel);
  if (start < 0) return false;
  const remainder = normalized.slice(start + labelMatch.normalizedLabel.length);
  const firstNumber = remainder.search(/(?:\(|^|\s)[-+]?\d/);
  const tail = (firstNumber >= 0 ? remainder.slice(0, firstNumber) : remainder).trim();
  if (!tail) return true;
  if (/^[\s·•*\-–—:()./]+$/u.test(tail)) return true;
  // Explicit statement row/note codes are valid after a row label. This is
  // intentionally bounded: prose such as "related to assets held for sale"
  // or "at period start" remains rejected.
  if (/^(?:note\s*)?(?:[a-z]\.)?\d+(?:[.]\d+)*$/iu.test(tail)) return true;
  if (/^\(?[a-z]\)?$/iu.test(tail)) return true;
  if (options.allowUnitQualifier === true && /^\(?\s*in\s+(?:eur|euro|euros|€)(?:\s+thousands?)?\s*\)?$/iu.test(tail)) return true;
  return false;
}

function explicitGroupCompanyColumns(pageText) {
  const lines = String(pageText || '')
    .split(/\r?\n/)
    .map((line) => normalizeLine(line))
    .filter(Boolean)
    .slice(0, 45);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // Structural table headers such as "GROUP COMPANY" are authoritative.
    // Ordinary prose mentioning both words is intentionally ignored.
    if (/^(?:group\s+company|company\s+group)$/.test(line)) return true;
    if (/^(?:group\s+company|company\s+group)\s+(?:note\s+)?(?:20\d{2}|\d{1,2}[./-]\d{1,2}[./-]20\d{2})/.test(line)) return true;

    const next = lines[index + 1] || '';
    if ((line === 'group' && next === 'company') || (line === 'company' && next === 'group')) return true;
  }
  return false;
}

function statementColumnLayout(pageText, contexts = []) {
  const text = normalizeLine(pageText);
  const hasGroupCompany = explicitGroupCompanyColumns(pageText);
  const hasContinuing = /\bcontinuing\b/.test(text);
  const hasDiscontinued = /\bdiscontinued\b/.test(text);
  if (contexts.includes('INCOME_STATEMENT') && hasContinuing && hasDiscontinued) {
    return { policy: 'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1', expectedColumns: 6, currentIndex: 2, comparativeIndex: 5 };
  }
  if (hasGroupCompany) {
    return { policy: 'GROUP_CURRENT_COMPARATIVE_V1', expectedColumns: 4, currentIndex: 0, comparativeIndex: 1 };
  }
  return { policy: 'STANDARD_CURRENT_COMPARATIVE_V1', expectedColumns: 2, currentIndex: 0, comparativeIndex: 1 };
}

function rawNumericStarts(line) {
  const result = [];
  const pattern = /\(?-?\d[\d.,]*\)?/g;
  for (const match of String(line || '').matchAll(pattern)) {
    const parsed = parseStatementNumber(match[0]);
    if (parsed === null) continue;
    result.push({ index: Number(match.index || 0), value: parsed, raw: match[0] });
  }
  return result;
}

function statementNoteColumns(pageText) {
  const columns = [];
  for (const line of String(pageText || '').split(/\r?\n/)) {
    const match = line.match(/\b(?:Note|Notes|Σημ(?:είωση|ειωση)?\.?)\b/iu);
    if (!match) continue;
    const tail = line.slice(Number(match.index || 0));
    if (!/(?:20\d{2}|\d{1,2}[./-]\d{1,2}[./-]20\d{2})/.test(tail)) continue;
    columns.push(Number(match.index || 0));
  }
  return [...new Set(columns)];
}

function stripAlignedStatementNoteReference(numbers, rawRow, rawPageText, rawOffset = 0) {
  if (!Array.isArray(numbers) || numbers.length < 3) return { numbers, stripped: false, noteValue: null };
  const first = Number(numbers[0]?.value);
  if (!Number.isInteger(first) || first < 1 || first > 99) return { numbers, stripped: false, noteValue: null };
  const firstRaw = rawNumericStarts(rawRow)[0] || null;
  if (!firstRaw) return { numbers, stripped: false, noteValue: null };
  const columns = statementNoteColumns(rawPageText);
  const absoluteFirstNumericIndex = Number(rawOffset || 0) + Number(firstRaw.index || 0);
  const aligned = columns.some((column) => Math.abs(absoluteFirstNumericIndex - column) <= 8);
  if (!aligned) return { numbers, stripped: false, noteValue: null };
  return { numbers: numbers.slice(1), stripped: true, noteValue: first };
}

function statementValues(numbers, pageText, contexts = [], rawRow = '', rawOffset = 0) {
  const noteAdjusted = stripAlignedStatementNoteReference(numbers, rawRow, pageText, rawOffset);
  const layout = statementColumnLayout(pageText, contexts);
  let values = [...noteAdjusted.numbers];

  // Preserve the existing bounded legacy note-reference fallback only after
  // positional Note-column alignment has had the first opportunity.
  if (
    values.length === layout.expectedColumns + 1 &&
    /^\d{1,2}$/.test(String(values[0]?.raw || '').replace(/[()]/g, ''))
  ) {
    values = values.slice(1);
  }

  if (values.length < layout.expectedColumns) return null;
  if (layout.expectedColumns > 2 && values.length > layout.expectedColumns) return null;
  const current = values[layout.currentIndex];
  const comparative = values[layout.comparativeIndex];
  if (!current || !comparative) return null;

  const reportedLayout = noteAdjusted.stripped && layout.expectedColumns === 2
    ? { ...layout, underlyingPolicy: layout.policy, policy: 'ALIGNED_NOTE_COLUMN_VALUES_V1' }
    : layout;
  return {
    selected: [current, comparative],
    layout: reportedLayout,
    noteReferenceRemoved: noteAdjusted.stripped,
    noteReference: noteAdjusted.noteValue,
  };
}

function statementPageAuthorityScore(pages, pageIndex, contexts = []) {
  const rawCurrent = String(pages[pageIndex] || '');
  const current = normalizeLine(rawCurrent);
  const previous = pageIndex > 0 ? normalizeLine(String(pages[pageIndex - 1] || '')) : '';
  const vicinity = current + ' ' + previous;
  const lines = rawCurrent.split(String.fromCharCode(10)).map((line) => normalizeLine(line)).filter(Boolean);
  let score = 0;

  // Audited/reviewed statement sections outrank Board Report, APM and ratio
  // summaries even when those summaries contain words such as "Income Statement".
  if (/summary interim financial statements|interim condensed financial information|interim financial statements|condensed financial statements/.test(vicinity)) score += 300;
  if (/notes? to (?:the )?(?:interim |condensed |consolidated )?financial statements/.test(current)) score -= 80;
  if (/board of directors report|review of h1 .* results|remarks on key figures|alternative performance measures|profitability ratios|definitions of financial figures/.test(current)) score -= 180;

  // The primary Income Statement outranks comprehensive-income recaps for
  // revenue/profit extraction. Condensed variants are equally authoritative.
  if (contexts.includes('INCOME_STATEMENT')) {
    if (lines.some((line) => /^(?:(?:condensed|consolidated)\s+){0,3}income statement(?: |$)/i.test(line))) score += 140;
    else if (lines.some((line) => /^(?:(?:condensed|consolidated)\s+){0,3}statement of comprehensive income(?: |$)/i.test(line))) score += 40;
  }
  if (contexts.includes('BALANCE_SHEET') && lines.some((line) => /^(?:(?:(?:condensed|consolidated)\s+){0,3}statement of financial position|(?:(?:condensed|consolidated)\s+){0,3}balance sheet)(?: |$)/i.test(line))) score += 140;
  if (contexts.includes('CASH_FLOW') && lines.some((line) => /^(?:(?:condensed|consolidated)\s+){0,3}(?:statement of cash flows?|cash flow statement)(?: |$)/i.test(line))) score += 140;
  if (contexts.includes('SHARE_COUNT_NOTE')) {
    const hasEpsHeading = lines.some((line) => /(?:^|\b)(?:earnings per share|eps)(?:\b|$)/i.test(line));
    const hasWeightedShareRow = lines.some((line) => /^weighted average number of (?:ordinary|diluted )?shares\b/i.test(line));
    if (hasEpsHeading && hasWeightedShareRow) score += 220;
    else if (hasWeightedShareRow) score += 160;
  }
  return score;
}

function hasAuthoritativeFinancialStatementSection(pages) {
  return pages.some((page) => /summary interim financial statements|interim condensed financial information|interim financial statements|condensed(?: consolidated)?(?: interim)? financial statements/i.test(normalizePdfGlyphs(String(page || ''))));
}

function stripStatementSectionPrefix(value) {
  return String(value || '').replace(/^\s*(?:ASSETS|LIABILITIES|EQUITY|OPERATING ACTIVITIES|INVESTING ACTIVITIES|FINANCING ACTIVITIES)\s+/i, '');
}

function horizontalLayoutChunks(rawRow) {
  const raw = String(rawRow || '');
  const chunks = [];
  const gapPattern = /\s{3,}/g;
  let cursor = 0;
  let match;

  const pushRange = (start, end) => {
    const slice = raw.slice(start, end);
    const firstNonSpace = slice.search(/\S/);
    if (firstNonSpace < 0) return;
    const trailingWhitespace = slice.match(/\s*$/)?.[0]?.length || 0;
    const text = slice.trim();
    if (!text) return;
    const absoluteStart = start + firstNonSpace;
    const absoluteEnd = start + slice.length - trailingWhitespace;
    chunks.push({ text, start: absoluteStart, end: absoluteEnd });
  };

  while ((match = gapPattern.exec(raw)) !== null) {
    pushRange(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  pushRange(cursor, raw.length);
  return chunks;
}

function horizontalMetricRowSegment(rawRow, labels = [], minimumNumbers = 2) {
  const raw = String(rawRow || '');
  if (!raw || !Array.isArray(labels) || !labels.length) return null;

  // pdftotext -layout preserves wide horizontal gaps. Financial reports often
  // place two independent accounting tables side-by-side, so one physical text
  // line can contain a complete left-table row followed by a right-table row.
  // Keep the original offsets as well as the bounded text: the bounded text is
  // used for numeric parsing while absolute offsets preserve Note-column proof.
  const chunks = horizontalLayoutChunks(raw);
  if (chunks.length < 2) return null;

  for (let index = 0; index < chunks.length; index += 1) {
    const originalChunk = chunks[index].text;
    const labelChunk = stripStatementSectionPrefix(originalChunk);
    const labelMatch = metricRowLabel(normalizeLine(labelChunk), labels);
    if (!labelMatch) continue;

    const parts = [labelChunk];
    let numberCount = financialNumericTokens(labelChunk).length;
    let cursor = index + 1;
    let lastIncludedIndex = index;

    for (; cursor < chunks.length; cursor += 1) {
      const chunk = chunks[cursor].text;
      const chunkNumbers = financialNumericTokens(chunk);
      const hasLetters = /[A-Za-zΑ-Ωα-ω]/u.test(normalizePdfGlyphs(chunk));

      if (hasLetters && numberCount >= minimumNumbers) break;
      if (hasLetters && numberCount > 0 && chunkNumbers.length === 0) break;

      parts.push(chunk);
      numberCount += chunkNumbers.length;
      lastIncludedIndex = cursor;
    }

    if (numberCount < minimumNumbers) continue;

    const fullNormalized = normalizeLine(raw);
    const fullLabelMatch = metricRowLabel(fullNormalized, labels);
    const hadSectionPrefix = labelChunk !== originalChunk;
    const hasFollowingStatementText = cursor < chunks.length;
    const targetWasNotFullRowAnchor = !fullLabelMatch;

    if (hadSectionPrefix || hasFollowingStatementText || targetWasNotFullRowAnchor) {
      const rawOffset = chunks[index].start;
      const rawEnd = chunks[lastIncludedIndex].end;
      return {
        line: parts.join(' '),
        rawSegment: raw.slice(rawOffset, rawEnd),
        rawOffset,
      };
    }
  }

  return null;
}

function findMetricRow(pages, labels, options = {}) {
  const maxPages = Math.min(pages.length, Number(options.maxPages || pages.length || 0));
  const contexts = Array.isArray(options.statementContexts) ? options.statementContexts : [];
  const maximumNumbers = Number(options.maximumNumbers || 4);
  const candidates = [];
  const authoritativeSectionPresent = contexts.length > 0 && hasAuthoritativeFinancialStatementSection(pages);

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const baseContextScore = statementContextScore(pages, pageIndex, contexts);
    if (contexts.length && baseContextScore <= 0) continue;
    const authorityScore = statementPageAuthorityScore(pages, pageIndex, contexts);
    if (authoritativeSectionPresent && authorityScore <= 0) continue;
    const contextScore = baseContextScore + authorityScore;
    const pageText = String(pages[pageIndex] || '');
    const notesPenalty = /notes? to (?:the )?(?:interim |consolidated )?financial statements/i.test(pageText) ? 35 : 0;
    const lineEntries = pageText.split(/\n+/).map((rawLine) => ({ rawLine, line: rawLine.trim() })).filter((entry) => entry.line);
    for (const entry of lineEntries) {
      const line = entry.line;
      const rawRow = entry.rawLine;
      const needed = Number(options.minimumNumbers || 2);
      const scopedSegment = horizontalMetricRowSegment(rawRow, labels, needed);
      const scopedLine = scopedSegment?.line || line;
      const scopedRawRow = scopedSegment?.rawSegment || rawRow;
      const scopedRawOffset = Number(scopedSegment?.rawOffset || 0);
      const normalized = normalizeLine(scopedLine);
      const labelMatch = metricRowLabel(normalized, labels);
      const label = labelMatch?.label || null;
      if (!label) continue;
      if (!metricLabelTailAllowed(normalized, labelMatch, options)) continue;
      if (options.exclude?.some((candidate) => normalized.includes(normalizeLine(candidate)))) continue;
      if (looksLikeTableOfContentsLine(scopedLine)) continue;
      if (looksLikeNarrativeMetricLine(scopedLine)) continue;
      const numbers = financialNumericTokens(scopedLine, { decimalMode: options.decimalMode === true });
      if (numbers.length < needed) continue;
      const columnSelection = statementValues(numbers, pageText, contexts, scopedRawRow, scopedRawOffset);
      if (!columnSelection) {
        if (numbers.length > maximumNumbers) continue;
      }
      const selected = columnSelection?.selected || numbers.slice(0, Math.max(needed, 2));
      candidates.push({
        label,
        line: scopedLine,
        physicalLine: line,
        rawRowOffset: scopedRawOffset,
        pageNumber: pageIndex + 1,
        values: selected.map((item) => item.value),
        scaleMultiplier: metricLineScale(line),
        extractionPolicy: 'STATEMENT_ROW_ONLY_V2',
        selectionPolicy: 'ACCOUNTING_STATEMENT_CONTEXT_V1',
        statementContexts: contexts,
        contextScore,
        labelScore: labelMatch?.score || 0,
        numberMode: options.decimalMode === true ? 'DECIMAL' : 'FINANCIAL_AMOUNT',
        statementColumnPolicy: columnSelection?.layout?.policy || 'STANDARD_CURRENT_COMPARATIVE_V1',
        statementColumnCount: columnSelection?.layout?.expectedColumns || 2,
        statementAuthorityScore: authorityScore,
        selectionScore: contextScore + (labelMatch?.score || 0) - notesPenalty - (columnSelection ? 0 : Math.max(0, numbers.length - needed) * 4),
      });
    }
  }

  const ranked = candidates.sort((a, b) => b.selectionScore - a.selectionScore || a.pageNumber - b.pageNumber);
  if (!ranked.length) return null;
  const winner = ranked[0];
  winner.candidateAudit = ranked.slice(0, 5).map((candidate) => ({
    pageNumber: candidate.pageNumber,
    line: candidate.line,
    selectionScore: candidate.selectionScore,
    contextScore: candidate.contextScore,
    statementAuthorityScore: candidate.statementAuthorityScore,
    statementColumnPolicy: candidate.statementColumnPolicy,
    statementColumnCount: candidate.statementColumnCount,
  }));
  return winner;
}

function boundedMetricRejectionAudit(pages, labels, options = {}) {
  const maxPages = Math.min(pages.length, Number(options.maxPages || pages.length || 0));
  const contexts = Array.isArray(options.statementContexts) ? options.statementContexts : [];
  const maximumNumbers = Number(options.maximumNumbers || 4);
  const needed = Number(options.minimumNumbers || 2);
  const authoritativeSectionPresent = contexts.length > 0 && hasAuthoritativeFinancialStatementSection(pages);
  const audit = [];
  const seen = new Set();

  const record = (reason, payload = {}) => {
    const key = [reason, payload.pageNumber || 0, String(payload.scopedLine || payload.physicalLine || '').slice(0, 120)].join('|');
    if (seen.has(key) || audit.length >= 12) return;
    seen.add(key);
    audit.push({
      reason,
      pageNumber: payload.pageNumber || null,
      physicalLine: String(payload.physicalLine || '').slice(0, 360),
      scopedLine: String(payload.scopedLine || '').slice(0, 280),
      pageContextSample: String(payload.pageContextSample || '').slice(0, 520),
      label: payload.label || null,
      baseContextScore: Number.isFinite(Number(payload.baseContextScore)) ? Number(payload.baseContextScore) : null,
      statementAuthorityScore: Number.isFinite(Number(payload.statementAuthorityScore)) ? Number(payload.statementAuthorityScore) : null,
      numberCount: Number.isFinite(Number(payload.numberCount)) ? Number(payload.numberCount) : null,
      statementColumnPolicy: payload.statementColumnPolicy || null,
      rawRowOffset: Number.isFinite(Number(payload.rawRowOffset)) ? Number(payload.rawRowOffset) : 0,
    });
  };

  for (let pageIndex = 0; pageIndex < maxPages && audit.length < 12; pageIndex += 1) {
    const pageText = String(pages[pageIndex] || '');
    const baseContextScore = statementContextScore(pages, pageIndex, contexts);
    const authorityScore = statementPageAuthorityScore(pages, pageIndex, contexts);
    const entries = pageText.split(/\n+/).map((rawLine) => ({ rawLine, line: rawLine.trim() })).filter((entry) => entry.line);
    const pageContextSample = entries.slice(0, 10).map((entry) => normalizeLine(entry.line)).join(' | ').slice(0, 520);

    for (const entry of entries) {
      if (audit.length >= 12) break;
      const rawRow = entry.rawLine;
      const physicalLine = entry.line;
      const scopedSegment = horizontalMetricRowSegment(rawRow, labels, needed);
      const scopedLine = scopedSegment?.line || physicalLine;
      const scopedRawRow = scopedSegment?.rawSegment || rawRow;
      const scopedRawOffset = Number(scopedSegment?.rawOffset || 0);
      const normalized = normalizeLine(scopedLine);
      const labelMatch = metricRowLabel(normalized, labels);
      if (!labelMatch) continue;

      const common = {
        pageNumber: pageIndex + 1,
        physicalLine,
        scopedLine,
        pageContextSample,
        label: labelMatch.label,
        baseContextScore,
        statementAuthorityScore: authorityScore,
        rawRowOffset: scopedRawOffset,
      };

      if (contexts.length && baseContextScore <= 0) {
        record('CONTEXT_REJECTED', common);
        continue;
      }
      if (authoritativeSectionPresent && authorityScore <= 0) {
        record('AUTHORITY_REJECTED', common);
        continue;
      }
      if (!metricLabelTailAllowed(normalized, labelMatch, options)) {
        record('ROW_TAIL_REJECTED', common);
        continue;
      }
      if (options.exclude?.some((candidate) => normalized.includes(normalizeLine(candidate)))) {
        record('EXCLUDED_VARIANT', common);
        continue;
      }
      if (looksLikeTableOfContentsLine(scopedLine)) {
        record('TABLE_OF_CONTENTS_REJECTED', common);
        continue;
      }
      if (looksLikeNarrativeMetricLine(scopedLine)) {
        record('NARRATIVE_REJECTED', common);
        continue;
      }

      const numbers = financialNumericTokens(scopedLine, { decimalMode: options.decimalMode === true });
      if (numbers.length < needed) {
        record('INSUFFICIENT_NUMBERS', { ...common, numberCount: numbers.length });
        continue;
      }

      const columnSelection = statementValues(numbers, pageText, contexts, scopedRawRow, scopedRawOffset);
      if (!columnSelection && numbers.length > maximumNumbers) {
        record('COLUMN_LAYOUT_REJECTED', {
          ...common,
          numberCount: numbers.length,
          statementColumnPolicy: statementColumnLayout(pageText, contexts)?.policy || null,
        });
        continue;
      }

      record('ACCEPTABLE_CANDIDATE_NOT_SELECTED', {
        ...common,
        numberCount: numbers.length,
        statementColumnPolicy: columnSelection?.layout?.policy || 'STANDARD_CURRENT_COMPARATIVE_V1',
      });
    }
  }

  return audit;
}

function metricPair(row, scale, period, concept) {
  if (!row?.values?.length || !period?.year) return [];
  const rowScale = Number(row?.scaleMultiplier || 1);
  const effectiveScale = rowScale > 1 ? rowScale : scale;
  const values = row.values.slice(0, 2).map((value) => value * effectiveScale);
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
    provenance: {
      pageNumber: row.pageNumber,
      extractedLine: row.line,
      sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT',
      metricExtractionPolicy: row.extractionPolicy || null,
      selectionPolicy: row.selectionPolicy || null,
      statementContexts: row.statementContexts || [],
      contextScore: Number.isFinite(Number(row.contextScore)) ? Number(row.contextScore) : null,
      labelScore: Number.isFinite(Number(row.labelScore)) ? Number(row.labelScore) : null,
      numberMode: row.numberMode || null,
      statementColumnPolicy: row.statementColumnPolicy || null,
      statementColumnCount: Number.isFinite(Number(row.statementColumnCount)) ? Number(row.statementColumnCount) : null,
      statementAuthorityScore: Number.isFinite(Number(row.statementAuthorityScore)) ? Number(row.statementAuthorityScore) : null,
      candidateAudit: Array.isArray(row.candidateAudit) ? row.candidateAudit : [],
      physicalLine: row.physicalLine || row.line || null,
      rawRowOffset: Number.isFinite(Number(row.rawRowOffset)) ? Number(row.rawRowOffset) : 0,
    },
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

function assessBalanceSheetIntegrity({ cash, assets, liabilities, equity } = {}) {
  const amount = (entry) => {
    const value = Number(entry?.value);
    return Number.isFinite(value) ? value : null;
  };
  const cashValue = amount(cash);
  const assetsValue = amount(assets);
  const liabilitiesValue = amount(liabilities);
  const equityValue = amount(equity);
  const issues = [];
  const checks = [];
  let balanceEquationDifferencePct = null;

  if (assetsValue !== null && assetsValue <= 0) issues.push('ASSETS_NON_POSITIVE');
  if (assetsValue !== null && cashValue !== null) {
    checks.push('CASH_NOT_GREATER_THAN_ASSETS');
    if (Math.abs(cashValue) > Math.abs(assetsValue) * 1.05) issues.push('CASH_EXCEEDS_ASSETS');
  }
  if (assetsValue !== null && liabilitiesValue !== null && equityValue !== null && assetsValue !== 0) {
    checks.push('ASSETS_EQUALS_LIABILITIES_PLUS_EQUITY');
    balanceEquationDifferencePct = Number((Math.abs(assetsValue - (liabilitiesValue + equityValue)) / Math.abs(assetsValue) * 100).toFixed(2));
    if (balanceEquationDifferencePct > 5) issues.push('BALANCE_SHEET_EQUATION_FAILED');
  }

  const ready = checks.includes('ASSETS_EQUALS_LIABILITIES_PLUS_EQUITY') && issues.length === 0;
  return {
    status: issues.length ? 'FAILED' : ready ? 'PASSED' : 'INSUFFICIENT_DATA',
    ready,
    checks,
    issues,
    balanceEquationDifferencePct,
    tolerancePct: 5,
  };
}

function derivedShares(netIncome, epsRow, period) {
  if (epsRow?.statementColumnPolicy === 'GROUP_TOTAL_CONTINUING_DISCONTINUED_V1' || Number(epsRow?.statementColumnCount || 2) > 2) return [];
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
    provenance: {
      pageNumber: epsRow.pageNumber,
      extractedLine: epsRow.line,
      derivation: 'netIncome / reported basic-and-diluted EPS',
      sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT',
      metricExtractionPolicy: epsRow.extractionPolicy || null,
      selectionPolicy: epsRow.selectionPolicy || null,
      statementContexts: epsRow.statementContexts || [],
      contextScore: Number.isFinite(Number(epsRow.contextScore)) ? Number(epsRow.contextScore) : null,
    },
  }];
}

export function buildAthensFundamentalSnapshotFromText(textInput, document, company, options = {}) {
  const pages = Array.isArray(options.pages) && options.pages.length
    ? options.pages.map((page) => typeof page === 'string' ? page : page?.text || '').filter(Boolean)
    : String(textInput || '').split('\f').filter(Boolean);
  const text = pages.length ? pages.join('\n\n') : String(textInput || '');
  const period = document?.period || periodFromTitle(document?.title || '');
  const scale = scaleFromText(text, pages);

  const revenueRow = findMetricRow(pages, ['revenue from sale of inventories', 'revenue from contracts with customers', 'total revenue', 'sales', 'revenue', 'turnover'], { statementContexts: ['INCOME_STATEMENT'], exclude: ['cost of sales', 'revenue reserve', 'revenue recognition'] });
  const netIncomeRow = findMetricRow(pages, ['net profit/ (loss) for the period', 'net profit/(loss) for the period', 'net profit for the period', 'profit/(loss) for the period', 'profit for the period', 'profit after tax', 'profit after taxes', 'net income'], { statementContexts: ['INCOME_STATEMENT'], exclude: ['before tax', 'before taxes'] });
  const operatingCashFlowRow = findMetricRow(pages, ['cash flow from operating activities', 'net cash from operating activities', 'net cash generated from operating activities', 'net cash generated from (+)/used in (-) operating activities', 'net cash generated from/used in operating activities'], { statementContexts: ['CASH_FLOW'] });
  const capexRow = findMetricRow(pages, ['purchase of tangible and intangible assets', 'purchase of property, plant and equipment', 'payments to acquire property plant and equipment', 'acquisition of property, plant and equipment and intangible assets', 'acquisition of property plant and equipment and intangible assets', 'capital expenditure'], { statementContexts: ['CASH_FLOW'] });
  const cashRow = findMetricRow(pages, ['cash and cash equivalents', 'cash & cash equivalents'], { statementContexts: ['BALANCE_SHEET'], exclude: ['beginning of period', 'end of period', 'change in', 'period start', 'at period start'] });
  const assetsRow = findMetricRow(pages, ['total assets'], { statementContexts: ['BALANCE_SHEET'] });
  const liabilitiesRow = findMetricRow(pages, ['total liabilities'], { statementContexts: ['BALANCE_SHEET'], exclude: ['equity and liabilities'] });
  const equityRow = findMetricRow(pages, ['total equity', 'total shareholders equity', 'shareholders equity'], { statementContexts: ['BALANCE_SHEET'], exclude: ['equity and liabilities'] });
  const directSharesRow = findMetricRow(pages, ['weighted average number of diluted shares', 'weighted average number of ordinary shares', 'weighted average number of shares', 'average number of shares'], { statementContexts: ['INCOME_STATEMENT', 'SHARE_COUNT_NOTE'], minimumNumbers: 1, maximumNumbers: 4, maxPages: 40 });
  const epsRow = findMetricRow(pages, ['restated basic earnings per share', 'basic earnings per share', 'basic and diluted', 'basic & diluted', 'diluted earnings per share'], { statementContexts: ['INCOME_STATEMENT'], minimumNumbers: 2, maximumNumbers: 8, decimalMode: true, allowUnitQualifier: true });

  const metricRejectionAudit = {
    ...(capexRow ? {} : { capitalExpenditure: boundedMetricRejectionAudit(pages, ['purchase of tangible and intangible assets', 'purchase of property, plant and equipment', 'payments to acquire property plant and equipment', 'acquisition of property, plant and equipment and intangible assets', 'acquisition of property plant and equipment and intangible assets', 'capital expenditure'], { statementContexts: ['CASH_FLOW'] }) }),
    ...(cashRow ? {} : { cash: boundedMetricRejectionAudit(pages, ['cash and cash equivalents', 'cash & cash equivalents'], { statementContexts: ['BALANCE_SHEET'], exclude: ['beginning of period', 'end of period', 'change in', 'period start', 'at period start'] }) }),
    ...(assetsRow ? {} : { assets: boundedMetricRejectionAudit(pages, ['total assets'], { statementContexts: ['BALANCE_SHEET'] }) }),
    ...(liabilitiesRow ? {} : { liabilities: boundedMetricRejectionAudit(pages, ['total liabilities'], { statementContexts: ['BALANCE_SHEET'], exclude: ['equity and liabilities'] }) }),
    ...(equityRow ? {} : { equity: boundedMetricRejectionAudit(pages, ['total equity', 'total shareholders equity', 'shareholders equity'], { statementContexts: ['BALANCE_SHEET'], exclude: ['equity and liabilities'] }) }),
  };

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
  const balanceSheetIntegrity = assessBalanceSheetIntegrity({ cash, assets, liabilities, equity });

  const required = [revenue[0], netIncome[0], cash, assets, liabilities, equity, dilutedShares[0]];
  const available = required.filter(Boolean).length;
  const model = classifyFundamentalModel(company);
  const bankLike = model.type === 'FINANCIAL_INSTITUTION';
  const realEstateLike = model.type === 'REAL_ESTATE';
  const genericModelEligible = model.genericValuationEligible === true;
  const extractionReady = available >= 6 && Boolean(revenue[0] && netIncome[0] && dilutedShares[0]);

  return {
    format: 'investor-control-euronext-athens-fundamentals',
    version: 1,
    companyId: company?.companyId || null,
    companyName: company?.displayName || company?.legalName || null,
    generatedAt: new Date(options.generatedAt || Date.now()).toISOString(),
    sourceUrl: document?.pdfUrl || null,
    model,
    sourceDocument: {
      title: document?.title || null,
      detailUrl: document?.detailUrl || null,
      indexUrl: document?.indexUrl || null,
      sourceChannel: document?.sourceChannel || null,
      authorityScore: document?.authorityScore ?? null,
      identityBinding: document?.identityBinding || null,
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
      annualRevenueGrowthPct: genericModelEligible ? growthPct(revenue) : null,
      annualNetMarginPct: genericModelEligible ? ratioPct(netIncome[0], revenue[0]) : null,
      dilutedSharesChangePct: dilutedShares.length > 1 ? growthPct(dilutedShares) : null,
      latestFreeCashFlow: genericModelEligible ? freeCashFlow : null,
      latestAnnualFreeCashFlowUSD: null,
    },
    coverage: {
      available,
      expected: required.length,
      score: Number(((available / required.length) * 100).toFixed(2)),
    },
    metricsReady: Boolean(document?.identityVerified && extractionReady && genericModelEligible && balanceSheetIntegrity.ready),
    quality: {
      identityVerified: document?.identityVerified === true,
      extractionReady,
      genericModelEligible,
      specializedModelRequired: model.specializedModelRequired,
      genericMetricsSuppressed: !genericModelEligible,
      flowDataAnnualComparable: Number(period?.months) === 12,
      derivedShareCount: dilutedShares.some((entry) => entry.derived === true),
      sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT',
      balanceSheetIntegrity,
      rowLabelPolicy: 'ROW_LABEL_ANCHORED_V1',
      numericSemanticsPolicy: 'FINANCIAL_TABLE_NUMBER_V1',
      // The rejection audit diagnoses the generic operating-company extractor.
      // Specialized instruments keep their raw facts but must not expose
      // irrelevant generic-metric rejection noise.
      metricRejectionAudit: genericModelEligible ? metricRejectionAudit : {},
    },
  };
}

function financialDataUrl(company) {
  if (company?.marketData?.euronextFinancialDataUrl) return company.marketData.euronextFinancialDataUrl;
  const issuerId = String(company?.issuerId || '').trim();
  return issuerId ? `${BASE_URL}/en/market-data/issuers/${encodeURIComponent(issuerId)}/financial-data` : null;
}

function stampFinancialSourceRole(snapshot, document) {
  const sourceRole = document?.sourceChannel === 'ISSUER_IR_OFFICIAL'
    ? 'PRIMARY_ISSUER_FINANCIAL_DOCUMENT'
    : 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT';
  const stamp = (fact) => {
    if (!fact) return;
    fact.provenance = {
      ...(fact.provenance || {}),
      sourceRole,
      sourceChannel: document?.sourceChannel || null,
      sourceUrl: document?.pdfUrl || null,
      identityBinding: document?.identityBinding || null,
    };
  };
  for (const series of Object.values(snapshot?.annual || {})) {
    if (Array.isArray(series)) for (const fact of series) stamp(fact);
  }
  for (const fact of Object.values(snapshot?.instant || {})) stamp(fact);
  snapshot.sourceDocument = {
    ...(snapshot.sourceDocument || {}),
    sourceRole,
    sourceChannel: document?.sourceChannel || null,
    authorityScore: document?.authorityScore ?? null,
    identityBinding: document?.identityBinding || null,
  };
  snapshot.quality = { ...(snapshot.quality || {}), sourceRole };
  return snapshot;
}

export async function fetchEuronextAthensFundamentals(company, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Euronext Athens fundamentals adapter requires fetch');
  const pageUrl = financialDataUrl(company);
  if (!pageUrl) return { snapshot: null, diagnostics: [{ code: 'ATHENS_FINANCIAL_ISSUER_ID_MISSING', companyId: company?.companyId }] };

  const resolvedDocument = await resolveEuronextAthensFinancialDocument(company, {
    fetchImpl,
    financialDataUrl: pageUrl,
    extractFinancialDocuments: extractAthensFinancialDocuments,
    generatedAt: options.generatedAt,
    userAgent: options.userAgent || 'Investor-Control-Market-Intelligence/1.5',
    minimumIdentityScore: options.minimumIdentityScore,
    announcementLimit: options.announcementLimit,
    detailLimit: options.financialAnnouncementDetailLimit,
  });
  if (!resolvedDocument.document) {
    return {
      snapshot: null,
      diagnostics: resolvedDocument.diagnostics || [{ code: 'EURONEXT_FINANCIAL_DOCUMENT_RESOLUTION_FAILED', companyId: company?.companyId }],
    };
  }

  const resolverDiagnostics = resolvedDocument.diagnostics || [];
  const rankedCandidates = Array.isArray(resolvedDocument.candidates) && resolvedDocument.candidates.length
    ? resolvedDocument.candidates
    : [resolvedDocument.document].filter(Boolean);
  const maxCandidateReviews = Math.max(1, Math.min(Number(options.maxFinancialCandidateReviews || 6), 12));
  const pdfExtractor = options.pdfExtractor || extractPdfText;
  const candidateDiagnostics = [];
  let selected = null;

  for (let candidateIndex = 0; candidateIndex < Math.min(rankedCandidates.length, maxCandidateReviews); candidateIndex += 1) {
    const document = rankedCandidates[candidateIndex];
    const rank = candidateIndex + 1;
    let pdfResponse;
    try {
      pdfResponse = await fetchImpl(document.pdfUrl, {
        headers: { Accept: 'application/pdf', 'Cache-Control': 'no-cache', 'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/1.5' },
      });
    } catch (error) {
      candidateDiagnostics.push({
        code: 'EURONEXT_FINANCIAL_CANDIDATE_REJECTED',
        companyId: company?.companyId,
        candidateRank: rank,
        pdfUrl: document?.pdfUrl || null,
        sourceChannel: document?.sourceChannel || null,
        reason: 'PDF_FETCH_ERROR',
        error: String(error?.message || error),
      });
      continue;
    }
    if (!pdfResponse?.ok) {
      candidateDiagnostics.push({
        code: 'EURONEXT_FINANCIAL_CANDIDATE_REJECTED',
        companyId: company?.companyId,
        candidateRank: rank,
        pdfUrl: document?.pdfUrl || null,
        sourceChannel: document?.sourceChannel || null,
        reason: 'PDF_HTTP_ERROR',
        status: pdfResponse?.status ?? null,
      });
      continue;
    }

    const buffer = Buffer.from(await pdfResponse.arrayBuffer());
    const extracted = await pdfExtractor(buffer, {
      maxBytes: options.maxBytes,
      minReviewedText: options.minReviewedText,
      timeoutMs: options.timeoutMs,
    });
    if (!extracted?.reviewed) {
      candidateDiagnostics.push({
        code: 'EURONEXT_FINANCIAL_CANDIDATE_REJECTED',
        companyId: company?.companyId,
        candidateRank: rank,
        pdfUrl: document?.pdfUrl || null,
        sourceChannel: document?.sourceChannel || null,
        reason: 'PDF_NOT_REVIEWED',
        extractionStatus: extracted?.status || null,
        diagnostics: extracted?.diagnostics || [],
      });
      continue;
    }

    const pageTexts = Array.isArray(extracted.pages) && extracted.pages.length
      ? extracted.pages.map((page) => extracted.text.slice(page.textStart, page.textEnd))
      : [];
    const candidateSnapshot = buildAthensFundamentalSnapshotFromText(extracted.text, document, company, {
      generatedAt: options.generatedAt,
      pages: pageTexts,
      extractionStatus: extracted.status,
    });
    stampFinancialSourceRole(candidateSnapshot, document);

    if (candidateSnapshot.model?.type === 'FINANCIAL_INSTITUTION') {
      const bankPassport = buildAthensBankPassport(pageTexts, candidateSnapshot, company, { generatedAt: candidateSnapshot.generatedAt });
      candidateSnapshot.specializedModels = { ...(candidateSnapshot.specializedModels || {}), bank: bankPassport };
      candidateSnapshot.model = {
        ...candidateSnapshot.model,
        specializedModelImplemented: true,
        modelReady: bankPassport.modelReady,
        specializedModelStatus: bankPassport.status,
      };
      candidateSnapshot.quality = {
        ...(candidateSnapshot.quality || {}),
        specializedModelImplemented: true,
        bankPassportStatus: bankPassport.status,
        bankPassportBlockers: bankPassport.blockers,
      };
      candidateSnapshot.metricsReady = bankPassport.decisionReady === true;
    }

    const bankPassport = candidateSnapshot?.specializedModels?.bank || null;
    const genericCoverage = Number(candidateSnapshot?.coverage?.available || 0);
    const bankCoreCoverage = Number(bankPassport?.coverage?.core?.availableCount || 0);
    const accountingCoverage = bankPassport ? bankCoreCoverage : genericCoverage;
    const minimumFacts = Number(options.minimumFinancialStatementFacts || 3);
    const genericFacts = [
      ...Object.values(candidateSnapshot?.annual || {}).flatMap((value) => Array.isArray(value) ? value : []),
      ...Object.values(candidateSnapshot?.instant || {}).filter(Boolean),
    ];
    const genericAuthorityReady = bankPassport
      ? true
      : genericFacts.length >= minimumFacts && genericFacts.every((fact) => Number(fact?.provenance?.statementAuthorityScore || 0) > 0);
    const financialStatementVerified = bankPassport
      ? bankCoreCoverage >= minimumFacts
      : accountingCoverage >= minimumFacts && genericAuthorityReady;

    if (!financialStatementVerified) {
      candidateDiagnostics.push({
        code: 'EURONEXT_FINANCIAL_CANDIDATE_REJECTED',
        companyId: company?.companyId,
        candidateRank: rank,
        pdfUrl: document?.pdfUrl || null,
        sourceChannel: document?.sourceChannel || null,
        reason: !bankPassport && accountingCoverage >= minimumFacts && !genericAuthorityReady
          ? 'STATEMENT_AUTHORITY_NOT_VERIFIED'
          : 'INSUFFICIENT_FINANCIAL_STATEMENT_CONTENT',
        extractionStatus: extracted.status,
        accountingCoverage,
        genericCoverage,
        bankCoreCoverage,
        genericAuthorityReady,
      });
      continue;
    }

    candidateSnapshot.sourceDocument = {
      ...(candidateSnapshot.sourceDocument || {}),
      candidateSelection: {
        policyVersion: '2026-08-08.1',
        reviewedSelected: true,
        candidateRank: rank,
        candidatesAvailable: rankedCandidates.length,
        candidatesAttempted: rank,
        rejectedBeforeSelection: candidateDiagnostics.filter((item) => item.code === 'EURONEXT_FINANCIAL_CANDIDATE_REJECTED').length,
        accountingCoverage,
        sourceChannel: document?.sourceChannel || null,
      },
    };
    candidateDiagnostics.push({
      code: 'EURONEXT_FINANCIAL_REVIEWED_CANDIDATE_SELECTED',
      companyId: company?.companyId,
      candidateRank: rank,
      pdfUrl: document?.pdfUrl || null,
      sourceChannel: document?.sourceChannel || null,
      extractionStatus: extracted.status,
      accountingCoverage,
      bankDecisionReady: bankPassport?.decisionReady ?? null,
    });
    selected = { document, extracted, pageTexts, snapshot: candidateSnapshot };
    break;
  }

  if (!selected) {
    return {
      snapshot: null,
      diagnostics: [
        ...resolverDiagnostics,
        ...candidateDiagnostics,
        {
          code: 'EURONEXT_FINANCIAL_NO_REVIEWED_STATEMENT_CANDIDATE',
          companyId: company?.companyId,
          candidatesAvailable: rankedCandidates.length,
          candidatesAttempted: Math.min(rankedCandidates.length, maxCandidateReviews),
        },
      ],
    };
  }

  const snapshot = selected.snapshot;
  const diagnostics = [...resolverDiagnostics, ...candidateDiagnostics];
  if (!snapshot.quality.identityVerified) diagnostics.push({ code: 'ATHENS_FINANCIAL_IDENTITY_NOT_VERIFIED', companyId: company?.companyId });
  if (!snapshot.quality.extractionReady && snapshot.model?.specializedModelImplemented !== true) diagnostics.push({ code: 'ATHENS_FINANCIAL_METRICS_INCOMPLETE', companyId: company?.companyId, coverage: snapshot.coverage.score });
  if (snapshot.quality.balanceSheetIntegrity?.status === 'FAILED') diagnostics.push({
    code: 'ATHENS_FINANCIAL_BALANCE_SHEET_INTEGRITY_FAILED',
    companyId: company?.companyId,
    issues: snapshot.quality.balanceSheetIntegrity.issues,
    balanceEquationDifferencePct: snapshot.quality.balanceSheetIntegrity.balanceEquationDifferencePct,
  });
  if (!snapshot.quality.genericModelEligible && snapshot.model?.specializedModelImplemented !== true) diagnostics.push({ code: 'ATHENS_FINANCIAL_SECTOR_MODEL_REQUIRED', companyId: company?.companyId });
  if (snapshot.model?.type === 'FINANCIAL_INSTITUTION' && snapshot.model?.specializedModelImplemented === true && snapshot.specializedModels?.bank?.decisionReady !== true) diagnostics.push({
    code: 'ATHENS_BANK_PASSPORT_INCOMPLETE',
    companyId: company?.companyId,
    status: snapshot.specializedModels?.bank?.status || 'INSUFFICIENT_BANK_DATA',
    blockers: snapshot.specializedModels?.bank?.blockers || [],
    coreCoverage: snapshot.specializedModels?.bank?.coverage?.core || null,
    assetQualityCoverage: snapshot.specializedModels?.bank?.coverage?.assetQuality || null,
    regulatoryCapitalCoverage: snapshot.specializedModels?.bank?.coverage?.regulatoryCapital || null,
  });
  if (!snapshot.reporting.annualComparable) diagnostics.push({ code: 'ATHENS_FINANCIAL_INTERIM_FLOW_BASIS', companyId: company?.companyId, periodMonths: snapshot.reporting.periodMonths });
  return { snapshot, diagnostics };
}

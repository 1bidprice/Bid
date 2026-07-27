const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function compactExcerpt(text, index, length, radius = 90) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function parseLocalizedNumber(raw) {
  const cleaned = String(raw || '').replace(/\s/g, '');
  if (!cleaned) return null;

  const comma = cleaned.lastIndexOf(',');
  const dot = cleaned.lastIndexOf('.');
  let normalized = cleaned;

  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (comma >= 0) {
    const decimals = cleaned.length - comma - 1;
    normalized = decimals === 3 ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  } else if (dot >= 0) {
    const decimals = cleaned.length - dot - 1;
    normalized = decimals === 3 ? cleaned.replace(/\./g, '') : cleaned;
  }

  const value = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(value) ? value : null;
}

export function extractDocumentObservations(record, options = {}) {
  const text = String(record?.rawText || '');
  const maxPerType = Number(options.maxPerType || 40);
  const currencies = [];
  const percentages = [];
  const shareCounts = [];
  const dates = [];

  const currencyPattern = /(?:€|\$|£|EUR|USD|GBP)\s?[-+]?\d[\d.,]*(?:\s?(?:million|billion|thousand|m|bn|k))?|[-+]?\d[\d.,]*(?:\s?(?:million|billion|thousand|m|bn|k))?\s?(?:€|\$|£|EUR|USD|GBP)/gi;
  let match;
  while ((match = currencyPattern.exec(text)) && currencies.length < maxPerType) {
    currencies.push({
      raw: match[0],
      value: parseLocalizedNumber(match[0]),
      excerpt: compactExcerpt(text, match.index, match[0].length),
    });
  }

  const percentPattern = /[-+]?\d+(?:[.,]\d+)?\s?%/g;
  while ((match = percentPattern.exec(text)) && percentages.length < maxPerType) {
    percentages.push({
      raw: match[0],
      value: parseLocalizedNumber(match[0]),
      excerpt: compactExcerpt(text, match.index, match[0].length),
    });
  }

  const sharesPattern = /\b\d[\d.,]*(?:\s?(?:million|billion|thousand|m|bn|k))?\s+(?:ordinary\s+|common\s+|registered\s+|voting\s+|treasury\s+)?shares\b/gi;
  while ((match = sharesPattern.exec(text)) && shareCounts.length < maxPerType) {
    shareCounts.push({
      raw: match[0],
      value: parseLocalizedNumber(match[0]),
      excerpt: compactExcerpt(text, match.index, match[0].length),
    });
  }

  const datePattern = new RegExp(`\\b(?:\\d{1,2}\\s+(?:${MONTH_NAMES.join('|')})\\s+\\d{4}|(?:${MONTH_NAMES.join('|')})\\s+\\d{1,2},?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})\\b`, 'gi');
  while ((match = datePattern.exec(text)) && dates.length < maxPerType) {
    dates.push({
      raw: match[0],
      excerpt: compactExcerpt(text, match.index, match[0].length),
    });
  }

  const sections = [];
  const sectionPattern = /\b(?:item\s+\d+(?:\.\d+)?|risk factors|management(?:'s)? discussion and analysis|financial statements|liquidity and capital resources|results of operations|share capital|voting rights|share buyback|related party transactions)\b/gi;
  while ((match = sectionPattern.exec(text)) && sections.length < maxPerType) {
    sections.push(match[0].replace(/\s+/g, ' ').trim());
  }

  return {
    extractionVersion: 1,
    documentReviewed: record?.document?.reviewed === true,
    textLength: text.length,
    currencyAmounts: uniqueBy(currencies, (item) => `${item.raw}|${item.excerpt}`).slice(0, maxPerType),
    percentages: uniqueBy(percentages, (item) => `${item.raw}|${item.excerpt}`).slice(0, maxPerType),
    shareCounts: uniqueBy(shareCounts, (item) => `${item.raw}|${item.excerpt}`).slice(0, maxPerType),
    dates: uniqueBy(dates, (item) => `${item.raw}|${item.excerpt}`).slice(0, maxPerType),
    sections: [...new Set(sections.map((value) => value.toLowerCase()))],
  };
}

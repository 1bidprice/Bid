export const SEC_BANK_REGULATORY_CAPITAL_VERSION = '2026-08-07.3';

const FORM_PATTERN = /\b(10-K\/A|10-Q\/A|10-K|10-Q)\b/i;
const RATIO_PATTERNS = Object.freeze({
  commonEquityTier1Pct: /common\s+equity\s+tier\s*1(?:\s+capital)?(?:\s+ratio)?/i,
  tier1CapitalPct: /^(?!.*common\s+equity).*tier\s*1\s+capital(?:\s+ratio)?/i,
  totalCapitalPct: /total\s+capital(?:\s+ratio)?/i,
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function percentages(text) {
  return [...String(text || '').matchAll(/(-?\d{1,2}(?:\.\d{1,4})?)\s*%/g)]
    .map((match) => ({ value: finite(match[1]), raw: match[0], index: match.index ?? 0 }))
    .filter((item) => item.value !== null && item.value >= 3 && item.value <= 50);
}

function lineCandidates(lines, pattern) {
  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || '').trim();
    if (!pattern.test(line)) continue;
    const sameLineRatios = percentages(line);
    const next = String(lines[index + 1] || '').trim();
    const ratioSource = sameLineRatios.length ? line : [line, next].filter(Boolean).join(' ');
    const ratios = sameLineRatios.length ? sameLineRatios : percentages(ratioSource);
    if (!ratios.length) continue;

    const loweredLine = line.toLowerCase();
    const minimumRow = /minimum|required|well[- ]capitalized|adequately capitalized|regulatory minimum|buffer requirement/.test(loweredLine);
    const actualBonus = /actual|company|bank|capital ratio|capital ratios/.test(loweredLine) ? 20 : 0;
    const sameLineBonus = sameLineRatios.length ? 30 : 0;
    const ratio = ratios[0];
    candidates.push({
      value: round(ratio.value),
      lineNumber: index + 1,
      excerpt: ratioSource.slice(0, 500),
      score: 100 + actualBonus + sameLineBonus - (minimumRow ? 120 : 0),
      minimumRow,
    });
  }
  return candidates
    .filter((candidate) => candidate.minimumRow !== true)
    .sort((a, b) => b.score - a.score || a.lineNumber - b.lineNumber);
}

function extractRatio(lines, pattern) {
  return lineCandidates(lines, pattern)[0] || null;
}

function filingForm(record) {
  return String(record?.title || '').match(FORM_PATTERN)?.[1]?.toUpperCase() || null;
}

function eligibleRecord(record) {
  const form = filingForm(record);
  return Boolean(
    record?.sourceType === 'REGULATORY_FILING' &&
    record?.sourceName === 'SEC EDGAR' &&
    record?.isPrimarySource === true &&
    record?.document?.reviewed === true &&
    ['REVIEWED_TEXT', 'REVIEWED_PDF'].includes(record?.document?.status) &&
    typeof record?.rawText === 'string' &&
    record.rawText.length >= 400 &&
    ['10-K', '10-K/A', '10-Q', '10-Q/A'].includes(form),
  );
}

function consistentCapital(cet1, tier1, total) {
  if (![cet1, tier1, total].every((value) => Number.isFinite(Number(value)))) return false;
  const a = Number(cet1);
  const b = Number(tier1);
  const c = Number(total);
  return c >= b && b >= a && a >= 3 && c <= 50;
}

function parseRecord(record) {
  if (!eligibleRecord(record)) return null;
  const lines = String(record.rawText).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const cet1 = extractRatio(lines, RATIO_PATTERNS.commonEquityTier1Pct);
  const tier1 = extractRatio(lines, RATIO_PATTERNS.tier1CapitalPct);
  const total = extractRatio(lines, RATIO_PATTERNS.totalCapitalPct);
  if (!cet1 || !tier1 || !total) return null;
  if (!consistentCapital(cet1.value, tier1.value, total.value)) return null;

  const accession = String(record.sourceDocumentId || record.id || '').replace(/^evidence:sec:/, '') || null;
  if (!accession || !record.sourceUrl) return null;

  return {
    format: 'investor-control-sec-bank-regulatory-capital',
    version: 1,
    policyVersion: SEC_BANK_REGULATORY_CAPITAL_VERSION,
    sourceRole: 'REVIEWED_SEC_FILING_TABLE',
    evidenceId: record.id,
    accession,
    form: filingForm(record),
    sourceUrl: record.sourceUrl,
    filedAt: record.publishedAt || null,
    reviewedAt: record.document?.fetchedAt || record.retrievedAt || null,
    commonEquityTier1Pct: cet1.value,
    tier1CapitalPct: tier1.value,
    totalCapitalPct: total.value,
    provenance: {
      commonEquityTier1Pct: { lineNumber: cet1.lineNumber, excerpt: cet1.excerpt },
      tier1CapitalPct: { lineNumber: tier1.lineNumber, excerpt: tier1.excerpt },
      totalCapitalPct: { lineNumber: total.lineNumber, excerpt: total.excerpt },
    },
    validation: {
      allThreeRatiosFromSameFiling: true,
      orderingConsistent: true,
      regulatoryMinimumRowsRejected: true,
      valuesInExpectedRange: true,
    },
  };
}

export function extractSecBankRegulatoryCapitalFromEvidence(records = []) {
  const diagnostics = [];
  const eligible = (Array.isArray(records) ? records : [])
    .filter(eligibleRecord)
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));

  for (const record of eligible) {
    const capital = parseRecord(record);
    if (capital) return { capital, diagnostics };
    diagnostics.push({
      code: 'SEC_BANK_REGULATORY_CAPITAL_NOT_VERIFIED_IN_FILING',
      evidenceId: record.id,
      accession: record.sourceDocumentId || null,
      form: filingForm(record),
    });
  }

  if (!eligible.length) {
    diagnostics.push({ code: 'SEC_BANK_REVIEWED_10K_10Q_REQUIRED' });
  }
  return { capital: null, diagnostics };
}

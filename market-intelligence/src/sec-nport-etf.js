export const SEC_NPORT_ETF_VERSION = '2026-08-12.1';

const clean = (v) => String(v ?? '').trim() || null;
const cik10 = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return d ? d.padStart(10, '0') : null; };
const seriesId = (v) => { const s = String(v ?? '').trim().toUpperCase(); return /^S\d{9}$/.test(s) ? s : null; };
const finite = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

function tag(xml, name) {
  const m = String(xml || '').match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, 'i'));
  return m ? clean(m[1].replace(/<[^>]*>/g, ' ')) : null;
}

function elements(xml, name) {
  const out = [];
  const re = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, 'gi');
  for (const m of String(xml || '').matchAll(re)) out.push(m[1]);
  return out;
}

export function normalizeSecEtfIdentity(input = {}) {
  const raw = input.secFundIdentity || input.fundIdentity?.sec || {};
  return { cik: cik10(raw.cik || input.cik), seriesId: seriesId(raw.seriesId || input.seriesId) };
}

export function parseSecNportEtf(xml, expectedIdentity = {}) {
  const diagnostics = [];
  const expected = { cik: cik10(expectedIdentity.cik), seriesId: seriesId(expectedIdentity.seriesId) };
  const filing = { cik: cik10(tag(xml, 'regCik') || tag(xml, 'cik')), seriesId: seriesId(tag(xml, 'seriesId')) };
  if (!expected.cik || !expected.seriesId) diagnostics.push({ code: 'ETF_SEC_FUND_IDENTITY_REQUIRED' });
  if (!filing.cik || filing.cik !== expected.cik) diagnostics.push({ code: 'SEC_NPORT_CIK_MISMATCH' });
  if (!filing.seriesId || filing.seriesId !== expected.seriesId) diagnostics.push({ code: 'SEC_NPORT_SERIES_MISMATCH' });
  if (diagnostics.length) return { capabilities: {}, diagnostics };

  const rows = elements(xml, 'invstOrSec');
  if (!rows.length) return { capabilities: {}, diagnostics: [{ code: 'SEC_NPORT_HOLDINGS_EMPTY' }] };
  const weights = [];
  let missingWeightCount = 0;
  let negativeWeightCount = 0;
  for (const row of rows) {
    const pct = finite(tag(row, 'pctVal'));
    if (pct === null) missingWeightCount += 1;
    else if (pct < 0) negativeWeightCount += 1;
    else weights.push(pct);
  }

  const capabilities = {
    HOLDINGS: { verified: true, sourceRole: 'PRIMARY_REGULATORY', count: rows.length, weightObservationCount: weights.length },
  };
  if (missingWeightCount) diagnostics.push({ code: 'SEC_NPORT_PCTVAL_COVERAGE_INCOMPLETE', missingWeightCount });
  if (negativeWeightCount) diagnostics.push({ code: 'SEC_NPORT_COMPLEX_NEGATIVE_EXPOSURE_UNSUPPORTED', negativeWeightCount });
  if (!missingWeightCount && !negativeWeightCount && weights.length) {
    const sorted = weights.sort((a, b) => b - a);
    capabilities.CONCENTRATION = {
      verified: true,
      sourceRole: 'PRIMARY_REGULATORY',
      largestHoldingWeightPct: Number(sorted[0].toFixed(6)),
      top10WeightPct: Number(sorted.slice(0, 10).reduce((s, v) => s + v, 0).toFixed(6)),
      methodology: 'FORM_NPORT_PCTVAL_TOP10_LONG_ONLY_V1',
    };
  }
  return { capabilities, diagnostics };
}

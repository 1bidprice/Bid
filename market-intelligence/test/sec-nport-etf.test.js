import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSecEtfIdentity, parseSecNportEtf } from '../src/sec-nport-etf.js';

const XML = `<?xml version="1.0"?>
<edgarSubmission><formData><genInfo><regCik>0001944285</regCik><seriesId>S000088946</seriesId></genInfo>
<invstOrSecs>
  <invstOrSec><name>Alpha</name><pctVal>20.5</pctVal></invstOrSec>
  <invstOrSec><name>Beta</name><pctVal>15</pctVal></invstOrSec>
  <invstOrSec><name>Gamma</name><pctVal>10</pctVal></invstOrSec>
  <invstOrSec><name>Delta</name><pctVal>5</pctVal></invstOrSec>
</invstOrSecs></formData></edgarSubmission>`;

const ID = { cik: '0001944285', seriesId: 'S000088946' };

test('normalizes only canonical SEC ETF identity and never derives it from ticker', () => {
  assert.deepEqual(normalizeSecEtfIdentity({ secFundIdentity: ID, primaryListing: { symbol: 'VOLT' } }), ID);
  assert.deepEqual(normalizeSecEtfIdentity({ primaryListing: { symbol: 'VOLT' } }), { cik: null, seriesId: null });
});

test('verified N-PORT identity yields holdings and concentration only', () => {
  const result = parseSecNportEtf(XML, ID);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.capabilities.HOLDINGS.verified, true);
  assert.equal(result.capabilities.HOLDINGS.count, 4);
  assert.equal(result.capabilities.CONCENTRATION.largestHoldingWeightPct, 20.5);
  assert.equal(result.capabilities.CONCENTRATION.top10WeightPct, 50.5);
  assert.equal(result.capabilities.EXPENSE_RATIO, undefined);
  assert.equal(result.capabilities.TRACKING_ERROR, undefined);
});

test('CIK or Series mismatch fails closed before holdings are accepted', () => {
  const wrongCik = parseSecNportEtf(XML, { ...ID, cik: '0001683471' });
  assert.deepEqual(wrongCik.capabilities, {});
  assert.ok(wrongCik.diagnostics.some((d) => d.code === 'SEC_NPORT_CIK_MISMATCH'));

  const wrongSeries = parseSecNportEtf(XML, { ...ID, seriesId: 'S000092105' });
  assert.deepEqual(wrongSeries.capabilities, {});
  assert.ok(wrongSeries.diagnostics.some((d) => d.code === 'SEC_NPORT_SERIES_MISMATCH'));
});

test('incomplete pctVal coverage keeps holdings but blocks concentration', () => {
  const xml = XML.replace('<pctVal>5</pctVal>', '');
  const result = parseSecNportEtf(xml, ID);
  assert.equal(result.capabilities.HOLDINGS.count, 4);
  assert.equal(result.capabilities.CONCENTRATION, undefined);
  assert.ok(result.diagnostics.some((d) => d.code === 'SEC_NPORT_PCTVAL_COVERAGE_INCOMPLETE'));
});

test('negative/complex exposure blocks simple concentration analytics', () => {
  const xml = XML.replace('<pctVal>5</pctVal>', '<pctVal>-5</pctVal>');
  const result = parseSecNportEtf(xml, ID);
  assert.equal(result.capabilities.HOLDINGS.count, 4);
  assert.equal(result.capabilities.CONCENTRATION, undefined);
  assert.ok(result.diagnostics.some((d) => d.code === 'SEC_NPORT_COMPLEX_NEGATIVE_EXPOSURE_UNSUPPORTED'));
});

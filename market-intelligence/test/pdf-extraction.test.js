import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPageProvenance, splitPdfTextPages } from '../src/pdf-extractor.js';
import { hydrateEvidenceDocument } from '../src/document-hydrator.js';
import { extractDocumentObservations } from '../src/document-observations.js';

const NOW = '2026-07-27T12:00:00.000Z';

function headers(contentType, contentLength) {
  return {
    get(name) {
      const key = String(name).toLowerCase();
      if (key === 'content-type') return contentType;
      if (key === 'content-length') return String(contentLength);
      return null;
    },
  };
}

function evidence() {
  return {
    id: 'evidence:test:pdf-report',
    sourceType: 'ISSUER_IR',
    sourceName: 'Issuer IR',
    sourceUrl: 'https://example.test/report.pdf',
    sourceDocumentId: 'report-1',
    publishedAt: NOW,
    retrievedAt: NOW,
    eventAt: NOW,
    title: 'Annual report',
    rawText: null,
    contentHash: '0123456789abcdef0123456789abcdef',
    language: 'en',
    companyIds: ['company:test'],
    claimType: 'FACT',
    reliabilityTier: 1,
    isPrimarySource: true,
    independenceGroup: 'issuer',
    supportsClaimIds: [],
    contradictsClaimIds: [],
    expiresAt: null,
    notes: 'Official PDF.',
  };
}

test('PDF page splitter preserves explicit page boundaries', () => {
  const pages = splitPdfTextPages('Page one facts\fPage two facts\f');
  assert.deepEqual(pages, ['Page one facts', 'Page two facts']);
  const provenance = buildPageProvenance(pages);
  assert.equal(provenance.pages.length, 2);
  assert.equal(provenance.text.slice(provenance.pages[1].textStart, provenance.pages[1].textEnd), 'Page two facts');
  assert.ok(provenance.pages.every((page) => page.contentHash.length >= 16));
});

test('hydrated PDF observations carry page-level provenance', async () => {
  const bytes = Buffer.from('%PDF-1.7 mocked');
  const pageOne = `Revenue was USD 12.5 million and increased 18%. ${'Verified operating context. '.repeat(15)}`;
  const pageTwo = `The company had 4,500,000 common shares outstanding. ${'Verified capital structure context. '.repeat(15)}`;
  const provenance = buildPageProvenance([pageOne, pageTwo]);
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: headers('application/pdf', bytes.length),
    arrayBuffer: async () => bytes,
  });
  const pdfExtractor = async () => ({
    status: 'REVIEWED_PDF',
    reviewed: true,
    text: provenance.text,
    pages: provenance.pages,
    diagnostics: [],
  });

  const hydrated = await hydrateEvidenceDocument(evidence(), {
    fetchImpl,
    pdfExtractor,
    retrievedAt: NOW,
  });
  assert.equal(hydrated.record.document.status, 'REVIEWED_PDF');
  assert.equal(hydrated.record.document.reviewed, true);
  assert.equal(hydrated.record.document.pages.length, 2);

  const observations = extractDocumentObservations(hydrated.record);
  assert.equal(observations.currencyAmounts[0].pageNumber, 1);
  assert.equal(observations.percentages[0].pageNumber, 1);
  assert.equal(observations.shareCounts[0].pageNumber, 2);
});

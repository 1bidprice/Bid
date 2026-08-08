import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToPlainText, hydrateEvidenceDocument } from '../src/document-hydrator.js';
import { extractDocumentObservations } from '../src/document-observations.js';
import { candidateFromEvidence } from '../src/event-classifier.js';
import { runDailyIntelligence } from '../src/run-daily-intelligence.js';

const NOW = '2026-07-27T10:00:00.000Z';

const ALLWYN = {
  companyId: 'company:allwyn-ag',
  legalName: 'Allwyn AG',
  displayName: 'Allwyn',
  primaryListing: { exchange: 'Euronext Athens', symbol: 'ALWN', mic: 'XATH' },
  issuerId: '863',
  country: 'CH',
  currency: 'EUR',
  active: true,
};

function headers(contentType, contentLength = null) {
  return {
    get(name) {
      const key = String(name).toLowerCase();
      if (key === 'content-type') return contentType;
      if (key === 'content-length' && contentLength !== null) return String(contentLength);
      return null;
    },
  };
}

function evidence(sourceUrl = 'https://example.test/announcement') {
  return {
    id: 'evidence:test:document-1',
    sourceType: 'ISSUER_IR',
    sourceName: 'Issuer IR',
    sourceUrl,
    sourceDocumentId: 'doc-1',
    publishedAt: NOW,
    retrievedAt: NOW,
    eventAt: NOW,
    title: 'Company purchased own shares',
    rawText: null,
    contentHash: 'hash-document-1',
    language: 'en',
    companyIds: [ALLWYN.companyId],
    claimType: 'FACT',
    reliabilityTier: 1,
    isPrimarySource: true,
    independenceGroup: 'issuer:test',
    supportsClaimIds: [],
    contradictsClaimIds: [],
    expiresAt: null,
    notes: null,
  };
}

test('HTML normalizer removes executable markup and keeps readable facts', () => {
  const text = htmlToPlainText(`
    <html><head><style>.hidden{display:none}</style><script>alert(1)</script></head>
    <body><h1>Share Buyback</h1><p>Purchased <strong>3,500 shares</strong> for EUR 47,600.00.</p></body></html>
  `);
  assert.equal(text.includes('alert(1)'), false);
  assert.match(text, /Share Buyback/);
  assert.match(text, /3,500 shares/);
  assert.match(text, /47,600\.00/);
});

test('official HTML document becomes reviewed evidence with deterministic observations', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: headers('text/html; charset=utf-8'),
    text: async () => `<article><h1>Share buyback</h1><p>The company purchased 3,500 shares for EUR 47,600.00, equal to 0.04% of issued capital.</p><p>${'Official transaction details. '.repeat(12)}</p></article>`,
  });
  const hydrated = await hydrateEvidenceDocument(evidence(), { fetchImpl, retrievedAt: NOW });
  assert.equal(hydrated.record.document.reviewed, true);
  assert.equal(hydrated.record.document.status, 'REVIEWED_HTML');
  assert.ok(hydrated.record.rawText.length >= 180);
  const observations = extractDocumentObservations(hydrated.record);
  assert.equal(observations.extractionVersion, 2);
  assert.ok(observations.currencyAmounts.some((item) => item.raw.includes('47,600')));
  assert.ok(observations.percentages.some((item) => item.raw.includes('0.04%')));
  assert.ok(observations.shareCounts.some((item) => item.raw.includes('3,500 shares')));
  assert.ok(observations.currencyAmounts.every((item) => item.pageNumber === null));

  const candidate = candidateFromEvidence({ ...hydrated.record, observations }, { hasPosition: true });
  assert.equal(candidate.requiresDeepReview, false);
  assert.equal(candidate.metricsReady, false);
});

test('PDF source is never treated as reviewed without a PDF extraction stage', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: headers('application/pdf', 2000),
    text: async () => '%PDF-1.7',
  });
  const hydrated = await hydrateEvidenceDocument(evidence('https://example.test/report.pdf'), {
    fetchImpl,
    retrievedAt: NOW,
  });
  assert.equal(hydrated.record.document.status, 'PDF_EXTRACTION_REQUIRED');
  assert.equal(hydrated.record.document.reviewed, false);
  assert.ok(hydrated.diagnostics.some((item) => item.code === 'PDF_TEXT_EXTRACTION_REQUIRED'));
});

test('daily runner reviews documents but blocks advice until all independent gates pass', async () => {
  const indexHtml = `
    <table><tbody><tr>
      <td>ALLWYN AG</td>
      <td><a href="/en/node/999002">Company purchased its own shares under share buyback programme</a></td>
      <td>20-07-2026 12:00</td>
    </tr></tbody></table>
  `;
  const documentHtml = `<article><h1>Share buyback programme</h1><p>The company purchased 3,500 shares for EUR 47,600.00 on 8 June 2026.</p><p>${'Official transaction details and capital allocation context. '.repeat(12)}</p></article>`;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('/market-data/issuers/863/announcements')) {
      return { ok: true, status: 200, headers: headers('text/html'), text: async () => indexHtml };
    }
    if (value.includes('/en/node/999002')) {
      return { ok: true, status: 200, headers: headers('text/html'), text: async () => documentHtml };
    }
    return { ok: true, status: 200, headers: headers('text/html'), text: async () => '<html></html>' };
  };

  const report = await runDailyIntelligence({
    universe: [ALLWYN],
    fetchImpl,
    now: NOW,
    documentLimit: 1,
    collectTrustedNews: false,
  });

  assert.equal(report.version, 5);
  assert.equal(report.documentReviewedCount, 1);
  assert.equal(report.researchDossierCount, 1);
  assert.equal(report.researchDossiers[0].status, 'DRAFT_RESEARCH');
  assert.ok(report.researchDossiers[0].thesis?.includes('επαναγοράς ιδίων μετοχών'));
  assert.equal(report.signals[0].analysisStage, 'DOCUMENT_REVIEWED');
  assert.equal(report.signals[0].status, 'DRAFT');
  assert.equal(report.signals[0].suggestedAction, 'WATCH');
  assert.equal(report.signals[0].readiness.publishable, false);
  assert.ok(report.signals[0].reasons.includes('FUNDAMENTALS_REQUIRED'));
  assert.ok(report.signals[0].reasons.includes('HISTORICAL_MARKET_METRICS_REQUIRED'));
  assert.ok(report.signals[0].reasons.includes('INDEPENDENT_CROSS_CHECK_REQUIRED'));
  assert.ok(!report.signals[0].reasons.includes('DOCUMENT_REVIEW_REQUIRED'));
  assert.ok(report.signals[0].observations.currencyAmountCount >= 1);
});

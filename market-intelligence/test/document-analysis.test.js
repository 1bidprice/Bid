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
    sourceDocumentId: null,
    publishedAt: NOW,
    retrievedAt: NOW,
    eventAt: NOW,
    title: 'Share buyback announcement',
    rawText: null,
    contentHash: '0123456789abcdef0123456789abcdef',
    language: 'en',
    companyIds: [ALLWYN.companyId],
    claimType: 'FACT',
    reliabilityTier: 1,
    isPrimarySource: true,
    independenceGroup: 'issuer',
    supportsClaimIds: [],
    contradictsClaimIds: [],
    expiresAt: null,
    notes: 'Official announcement.',
  };
}

test('HTML normalizer removes executable markup and keeps readable facts', () => {
  const text = htmlToPlainText(`
    <html><style>.hidden{display:none}</style><script>alert('x')</script>
    <body><h1>Share buyback</h1><p>The company purchased 3,500 shares for EUR 47,600.00.</p></body></html>
  `);
  assert.match(text, /Share buyback/);
  assert.match(text, /3,500 shares/);
  assert.doesNotMatch(text, /alert/);
  assert.doesNotMatch(text, /display:none/);
});

test('official HTML document becomes reviewed evidence with deterministic observations', async () => {
  const repeatedContext = 'The board approved the transaction after reviewing liquidity, capital allocation and shareholder interests. '.repeat(6);
  const body = `<article><h1>Share buyback</h1><p>On 8 June 2026 the company purchased 3,500 shares for EUR 47,600.00, representing 0.04% of voting rights.</p><p>${repeatedContext}</p></article>`;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: headers('text/html; charset=utf-8', Buffer.byteLength(body)),
    text: async () => body,
  });

  const hydrated = await hydrateEvidenceDocument(evidence(), {
    fetchImpl,
    retrievedAt: NOW,
  });
  assert.equal(hydrated.diagnostics.length, 0);
  assert.equal(hydrated.record.document.status, 'REVIEWED_TEXT');
  assert.equal(hydrated.record.document.reviewed, true);
  assert.deepEqual(hydrated.record.document.pages, []);
  assert.ok(hydrated.record.rawText.length >= 400);

  const observations = extractDocumentObservations(hydrated.record);
  assert.equal(observations.documentReviewed, true);
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

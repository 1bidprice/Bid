import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewTrustedNewsRecord, reviewTrustedNewsRecords } from '../src/trusted-news-review.js';

const NOW = '2026-07-27T12:00:00.000Z';
const COMPANY = {
  companyId: 'company:virgin-galactic-holdings',
  legalName: 'Virgin Galactic Holdings, Inc.',
  displayName: 'Virgin Galactic',
  primaryListing: { symbol: 'SPCE' },
};

function discovery(overrides = {}) {
  return {
    id: 'evidence:news:review-test',
    sourceType: 'FINANCIAL_NEWS',
    sourceName: 'Reuters',
    sourceUrl: 'https://news.google.com/rss/articles/redirect',
    sourceDocumentId: null,
    publishedAt: NOW,
    retrievedAt: NOW,
    eventAt: NOW,
    title: 'Virgin Galactic updates commercial service schedule - Reuters',
    rawText: 'RSS discovery excerpt.',
    contentHash: '0123456789abcdef0123456789abcdef',
    language: 'en',
    companyIds: [COMPANY.companyId],
    claimType: 'ESTIMATE',
    reliabilityTier: 2,
    isPrimarySource: false,
    independenceGroup: 'publisher:reuters',
    supportsClaimIds: [],
    contradictsClaimIds: [],
    expiresAt: '2026-08-10T12:00:00.000Z',
    notes: 'Discovery only.',
    ...overrides,
  };
}

function headers(contentType = 'text/html; charset=utf-8') {
  return {
    get(name) {
      return String(name).toLowerCase() === 'content-type' ? contentType : null;
    },
  };
}

test('trusted article review retains bounded factual excerpts and upgrades the claim to FACT', async () => {
  const body = `
    <html><head><style>.hidden{display:none}</style><script>window.tracker=true</script></head>
    <body>
      <article>
        <h1>Virgin Galactic updates commercial service schedule</h1>
        <p>Virgin Galactic said its commercial service schedule depends on completion of the next flight test and spacecraft programme milestone.</p>
        <p>${'The report describes the operational milestone, execution timetable, financing requirements and risks to commercial service. '.repeat(20)}</p>
        <p>Virgin Galactic said the next flight test remains an important step before commercial service can begin.</p>
      </article>
    </body></html>`;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    url: 'https://www.reuters.com/business/aerospace-defense/virgin-galactic-schedule-2026-07-27/',
    headers: headers(),
    text: async () => body,
  });

  const result = await reviewTrustedNewsRecord(discovery(), COMPANY, {
    fetchImpl,
    reviewedAt: NOW,
    maxRetained: 900,
  });

  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.record.claimType, 'FACT');
  assert.equal(result.record.document.status, 'REVIEWED_NEWS');
  assert.equal(result.record.document.reviewed, true);
  assert.equal(result.record.sourceUrl, 'https://www.reuters.com/business/aerospace-defense/virgin-galactic-schedule-2026-07-27/');
  assert.ok(result.record.rawText.includes('Virgin Galactic'));
  assert.ok(result.record.rawText.includes('flight test'));
  assert.ok(result.record.rawText.length <= 900);
  assert.doesNotMatch(result.record.rawText, /window\.tracker/);
  assert.doesNotMatch(result.record.rawText, /display:none/);
  assert.notEqual(result.record.contentHash, discovery().contentHash);
});

test('short or economically unclassified pages remain discovery evidence', async () => {
  const shortFetch = async () => ({
    ok: true,
    status: 200,
    url: 'https://www.reuters.com/short',
    headers: headers(),
    text: async () => '<p>Virgin Galactic commercial service.</p>',
  });
  const short = await reviewTrustedNewsRecord(discovery(), COMPANY, { fetchImpl: shortFetch, reviewedAt: NOW });
  assert.equal(short.record.claimType, 'ESTIMATE');
  assert.equal(short.record.document, undefined);
  assert.ok(short.diagnostics.some((item) => item.code === 'TRUSTED_NEWS_REVIEW_TEXT_TOO_SHORT'));

  const longButUnclassified = `<article><h1>Virgin Galactic community profile</h1><p>${'Virgin Galactic is discussed in a general company profile without a material corporate event. '.repeat(20)}</p></article>`;
  const unclassifiedFetch = async () => ({
    ok: true,
    status: 200,
    url: 'https://www.reuters.com/profile',
    headers: headers(),
    text: async () => longButUnclassified,
  });
  const unclassified = await reviewTrustedNewsRecord(discovery(), COMPANY, {
    fetchImpl: unclassifiedFetch,
    reviewedAt: NOW,
  });
  assert.equal(unclassified.record.claimType, 'ESTIMATE');
  assert.ok(unclassified.diagnostics.some((item) => item.code === 'TRUSTED_NEWS_REVIEW_EVENT_NOT_ESTABLISHED'));
});

test('review limit keeps excess RSS discoveries unreviewed and visible in diagnostics', async () => {
  const body = `<article><h1>Virgin Galactic flight test</h1><p>${'Virgin Galactic confirmed a flight test and operational milestone with execution and commercial service implications. '.repeat(18)}</p></article>`;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    url: 'https://www.reuters.com/flight-test',
    headers: headers(),
    text: async () => body,
  });
  const records = [discovery({ id: 'evidence:news:1' }), discovery({ id: 'evidence:news:2' })];
  const result = await reviewTrustedNewsRecords(records, COMPANY, {
    fetchImpl,
    reviewedAt: NOW,
    limit: 1,
  });
  assert.equal(result.records[0].document.status, 'REVIEWED_NEWS');
  assert.equal(result.records[1].document, undefined);
  assert.ok(result.diagnostics.some((item) => item.code === 'TRUSTED_NEWS_REVIEW_DEFERRED_BY_LIMIT'));
});

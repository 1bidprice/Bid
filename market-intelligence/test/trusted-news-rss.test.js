import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTrustedNewsEvidence } from '../src/adapters/trusted-news-rss.js';
import { assessIndependentEvidence } from '../src/cross-check.js';

const COMPANY = {
  companyId: 'company:virgin-galactic-holdings',
  legalName: 'Virgin Galactic Holdings, Inc.',
  displayName: 'Virgin Galactic',
  primaryListing: { symbol: 'SPCE' },
};

const NOW = '2026-07-27T12:00:00.000Z';

test('trusted RSS adapter keeps allowlisted publisher matches and rejects noise', () => {
  const xml = `
    <rss><channel>
      <item>
        <title><![CDATA[Virgin Galactic updates spacecraft schedule - Reuters]]></title>
        <link>https://news.google.com/rss/articles/reuters-story</link>
        <pubDate>Mon, 27 Jul 2026 09:00:00 GMT</pubDate>
        <description><![CDATA[Reuters reports that Virgin Galactic updated the schedule for its next spacecraft milestone.]]></description>
        <source url="https://reuters.com">Reuters</source>
      </item>
      <item>
        <title>SPCE to the moon - Unknown Blog</title>
        <link>https://example.test/blog</link>
        <pubDate>Mon, 27 Jul 2026 09:30:00 GMT</pubDate>
        <description>Virgin Galactic speculation.</description>
        <source>Unknown Blog</source>
      </item>
    </channel></rss>`;
  const result = extractTrustedNewsEvidence(xml, COMPANY, { retrievedAt: NOW });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].sourceName, 'Reuters');
  assert.equal(result.records[0].sourceType, 'FINANCIAL_NEWS');
  assert.equal(result.records[0].claimType, 'ESTIMATE');
  assert.equal(result.records[0].isPrimarySource, false);
  assert.ok(result.rejected.some((item) => item.code === 'PUBLISHER_NOT_ALLOWLISTED'));
});

test('RSS discovery can support investigation but cannot satisfy recommendation-grade review', () => {
  const issuer = {
    id: 'evidence:issuer:1',
    sourceType: 'REGULATORY_FILING',
    sourceName: 'SEC',
    sourceUrl: 'https://sec.test/filing',
    publishedAt: NOW,
    contentHash: 'issuer-hash-0123456789',
    companyIds: [COMPANY.companyId],
    claimType: 'FACT',
    reliabilityTier: 1,
    isPrimarySource: true,
    independenceGroup: 'regulator:sec',
    contradictsClaimIds: [],
    supportsClaimIds: [],
    document: { reviewed: true, status: 'REVIEWED_TEXT' },
  };
  const xml = `<rss><channel><item><title>Virgin Galactic schedule update - Reuters</title><link>https://news.google.com/rss/articles/1</link><pubDate>Mon, 27 Jul 2026 09:00:00 GMT</pubDate><description>Virgin Galactic schedule update.</description><source>Reuters</source></item></channel></rss>`;
  const news = extractTrustedNewsEvidence(xml, COMPANY, { retrievedAt: NOW }).records[0];
  const result = assessIndependentEvidence([issuer, news], NOW);
  assert.equal(result.discoveryReady, true);
  assert.equal(result.recommendationReady, false);
  assert.ok(result.blockers.includes('REVIEWED_INDEPENDENT_CORROBORATION_REQUIRED'));
});

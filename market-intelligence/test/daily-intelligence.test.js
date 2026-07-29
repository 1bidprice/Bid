import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAllwynAnnouncements } from '../src/adapters/allwyn-regulatory.js';
import { fetchSecRecentFilings } from '../src/adapters/sec-submissions.js';
import { classifyEvidenceEvent } from '../src/event-classifier.js';
import { runDailyIntelligence } from '../src/run-daily-intelligence.js';

const NOW = '2026-07-27T08:00:00.000Z';

const ALLWYN = {
  companyId: 'company:allwyn-ag',
  legalName: 'Allwyn AG',
  displayName: 'Allwyn',
  primaryListing: { exchange: 'Euronext Athens', symbol: 'ALWN', mic: 'XATH' },
  active: true,
};

const SPCE = {
  companyId: 'company:virgin-galactic-holdings',
  legalName: 'Virgin Galactic Holdings, Inc.',
  displayName: 'Virgin Galactic',
  primaryListing: { exchange: 'New York Stock Exchange', symbol: 'SPCE', mic: 'XNYS' },
  cik: '0001706946',
  active: true,
};

test('Allwyn parser produces primary evidence from dated official links', () => {
  const html = `
    <section>
      <div>20 July 2026</div>
      <a href="/regulatory-announcements/company-purchased-own-shares">Company purchased its own shares</a>
    </section>
  `;
  const records = extractAllwynAnnouncements(html, { retrievedAt: NOW, companyId: ALLWYN.companyId });
  assert.equal(records.length, 1);
  assert.equal(records[0].sourceType, 'ISSUER_IR');
  assert.equal(records[0].isPrimarySource, true);
  assert.equal(records[0].publishedAt, '2026-07-20T12:00:00.000Z');
  assert.match(records[0].sourceUrl, /allwyn\.com\/regulatory-announcements/);
});

test('SEC adapter normalizes recent filings without unsupported fields', async () => {
  const payload = {
    filings: {
      recent: {
        accessionNumber: ['0001706946-26-000115'],
        form: ['8-K/A'],
        filingDate: ['2026-06-29'],
        reportDate: ['2026-06-22'],
        primaryDocument: ['spce-20260622.htm'],
        items: ['3.02'],
      },
    },
  };
  const fetchImpl = async () => ({ ok: true, json: async () => payload });
  const result = await fetchSecRecentFilings(SPCE, {
    fetchImpl,
    userAgent: 'Investor Control test test@example.com',
    retrievedAt: NOW,
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].sourceType, 'REGULATORY_FILING');
  assert.equal(result.records[0].sourceDocumentId, '0001706946-26-000115');
  assert.equal('metadata' in result.records[0], false);
  assert.match(result.records[0].notes, /3\.02/);
});

test('event classification recognises dilution and buyback events', () => {
  const dilution = classifyEvidenceEvent({ title: '8-K — Unregistered Sales of Equity Securities' });
  const buyback = classifyEvidenceEvent({ title: 'Company purchased its own shares under share buyback programme' });
  assert.equal(dilution.category, 'EVENT_RISK');
  assert.equal(dilution.eventType, 'EQUITY_ISSUANCE_OR_DILUTION');
  assert.equal(buyback.category, 'EVENT_DRIVEN');
  assert.equal(buyback.eventType, 'SHARE_BUYBACK');
});

test('daily runner emits guarded signals, draft dossiers and an empty production feed', async () => {
  const allwynHtml = `
    <div>20 July 2026</div>
    <a href="/regulatory-announcements/company-purchased-own-shares">Company purchased its own shares under share buyback programme</a>
  `;
  const secPayload = {
    filings: {
      recent: {
        accessionNumber: ['0001706946-26-000115'],
        form: ['8-K/A'],
        filingDate: ['2026-06-29'],
        reportDate: ['2026-06-22'],
        primaryDocument: ['spce-20260622.htm'],
        items: ['3.02'],
      },
    },
  };
  const fetchImpl = async (url) => {
    if (String(url).includes('data.sec.gov')) return { ok: true, json: async () => secPayload };
    return { ok: true, headers: { get: () => 'text/html' }, text: async () => allwynHtml };
  };

  const report = await runDailyIntelligence({
    universe: [ALLWYN, SPCE],
    fetchImpl,
    secUserAgent: 'Investor Control test test@example.com',
    now: NOW,
    collectTrustedNews: false,
  });

  assert.equal(report.version, 5);
  assert.equal(report.evidenceCount, 2);
  assert.equal(report.signalCount, 2);
  assert.equal(report.researchDossierCount, 2);
  assert.equal(report.opportunitiesFeed.itemCount, 0);
  assert.ok(report.researchDossiers.every((dossier) => dossier.status === 'DRAFT_RESEARCH'));
  assert.ok(report.signals.every((signal) => signal.status === 'DRAFT'));
  assert.ok(report.signals.every((signal) => signal.suggestedAction === 'WATCH'));
  assert.ok(report.signals.every((signal) => signal.reasons.includes('DOCUMENT_REVIEW_REQUIRED')));
});

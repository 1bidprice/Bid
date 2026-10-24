import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendMinbeisHistoricalEventArchive,
  extractHistoricalEventsFromDossiers,
} from '../src/minbeis-historical-event-archive.js';

function dossier() {
  return {
    dossierId: 'dossier:test',
    companyId: 'company:test',
    companyName: 'Test plc',
    listing: { symbol: 'TEST' },
    evidence: [
      { evidenceId: 'e1', sourceName: 'Issuer', publishedAt: '2026-01-02T10:00:00Z', contentHash: 'a' },
      { evidenceId: 'e2', sourceName: 'Wire', publishedAt: '2026-01-03T12:00:00Z', contentHash: 'b' },
    ],
    metrics: {
      leadClaim: {
        claimId: 'c1',
        eventType: 'EARNINGS',
        category: 'RESULTS',
        statement: 'Revenue exceeded prior expectations.',
        evidenceIds: ['e1', 'e2'],
      },
    },
    catalysts: [{
      text: 'New contract starts contributing revenue.',
      eventType: 'COMMERCIAL_CONTRACT',
      category: 'CATALYST',
      evidenceIds: ['e1'],
      confidence: 0.9,
    }],
    risks: [],
  };
}

test('event availability is the latest publication time of all supporting evidence', () => {
  const records = extractHistoricalEventsFromDossiers([dossier()], '2026-01-04T00:00:00Z');
  const lead = records.find((x) => x.role === 'LEAD_CLAIM');
  assert.equal(lead.status, 'ARCHIVED');
  assert.equal(lead.availabilityAt, '2026-01-03T12:00:00.000Z');
  assert.equal(lead.replayEligible, true);
});

test('undated supporting evidence blocks replay eligibility', () => {
  const input = dossier();
  input.evidence[1].publishedAt = null;
  const [lead] = extractHistoricalEventsFromDossiers([input], '2026-01-04T00:00:00Z');
  assert.equal(lead.status, 'BLOCKED');
  assert.equal(lead.replayEligible, false);
  assert.ok(lead.blockers.includes('EVENT_SUPPORTING_EVIDENCE_UNDATED'));
});

test('append-only archive preserves original facts and first-seen time', () => {
  const first = appendMinbeisHistoricalEventArchive([], [dossier()], '2026-01-04T00:00:00Z');
  const secondInput = dossier();
  secondInput.companyName = 'Renamed Display';
  const second = appendMinbeisHistoricalEventArchive(first.records, [secondInput], '2026-01-10T00:00:00Z');
  assert.equal(second.recordCount, first.recordCount);
  assert.equal(second.newRecordCount, 0);
  const original = first.records.find((x) => x.role === 'LEAD_CLAIM');
  const repeated = second.records.find((x) => x.eventArchiveId === original.eventArchiveId);
  assert.equal(repeated.companyName, original.companyName);
  assert.equal(repeated.firstSeenAt, '2026-01-04T00:00:00.000Z');
  assert.equal(repeated.lastSeenAt, '2026-01-10T00:00:00.000Z');
});

test('new evidence set creates a new immutable event record', () => {
  const first = appendMinbeisHistoricalEventArchive([], [dossier()], '2026-01-04T00:00:00Z');
  const changed = dossier();
  changed.evidence.push({ evidenceId: 'e3', sourceName: 'Filing', publishedAt: '2026-01-05T09:00:00Z', contentHash: 'c' });
  changed.metrics.leadClaim.evidenceIds.push('e3');
  const second = appendMinbeisHistoricalEventArchive(first.records, [changed], '2026-01-06T00:00:00Z');
  assert.ok(second.recordCount > first.recordCount);
  assert.ok(second.newRecordCount >= 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEvidenceEvent } from '../src/event-classifier.js';

test('voting-rights headline wins over unrelated legal boilerplate in full page text', () => {
  const result = classifyEvidenceEvent({
    title: 'Notification of important changes concerning voting rights pursuant to L. 3556/2007',
    rawText: 'Navigation footer: legal proceedings, litigation, settlement, prospectus supplement.',
  });
  assert.equal(result.eventType, 'OWNERSHIP_OR_VOTING_RIGHTS');
  assert.equal(result.category, 'EVENT_DRIVEN');
});

test('424B7 headline is an offering document and cannot become an ownership event from page text', () => {
  const result = classifyEvidenceEvent({
    title: '424B7 filing — Virgin Galactic',
    rawText: 'The document contains voting rights, legal proceedings and other disclosure boilerplate.',
  });
  assert.equal(result.eventType, 'SECURITIES_OFFERING_REGISTRATION');
  assert.equal(result.category, 'EVENT_RISK');
});

test('unmatched headline remains unclassified even when page template contains unrelated keywords', () => {
  const result = classifyEvidenceEvent({
    title: 'General corporate announcement',
    rawText: 'Website menu: share buyback, litigation, voting rights, financial results.',
    document: { reviewed: true },
  });
  assert.equal(result.eventType, 'UNCLASSIFIED_OFFICIAL_EVENT');
  assert.equal(result.category, 'INSUFFICIENT_EVIDENCE');
});

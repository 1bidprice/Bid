import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('v1.8 runtime collects validated long history in-memory before shadow forecasting and serializes only its summary', () => {
  const autonomous = fs.readFileSync(new URL('../src/run-autonomous-intelligence.js', import.meta.url), 'utf8');
  assert.match(autonomous, /import \{ collectLongHistoryResearch \} from '\.\/long-history-collector\.js';/);
  assert.match(autonomous, /const longHistoryResearch = await collectLongHistoryResearch\(\{/);
  assert.match(autonomous, /longHistoryResearchCollector: longHistoryResearch\.collector/);
  assert.match(autonomous, /longHistoryResearchSummary: longHistoryResearch\.summary/);
  assert.doesNotMatch(autonomous, /longHistoryResearchSeries:/);
  assert.doesNotMatch(autonomous, /longHistoryResearchCollector:\s*longHistoryResearch\.collector[\s\S]*longHistoryResearchCollector,/);
});

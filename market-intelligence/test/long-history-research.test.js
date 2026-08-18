import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crossCheckLongHistorySeries,
  fetchLongHistoryResearchSeries,
  validateLongHistoryResearchSeries,
} from '../src/long-history-research.js';

function syntheticSeries({ count = 1400, start = 1_600_000_000, source = 'Yahoo Finance Chart', sourceUrl = 'https://query1.finance.yahoo.com/chart/TEST', rawMultiplier = 1, adjustedMultiplier = 0.92, wave = 0 }) {
  const candles = [];
  let level = 50;
  for (let index = 0; index < count; index += 1) {
    const daily = 0.0005 + Math.sin(index / 17) * 0.004;
    level *= 1 + daily;
    const noise = wave ? 1 + Math.sin(index / 3) * wave : 1;
    const rawClose = level * rawMultiplier * noise;
    candles.push({
      timestamp: start + index * 86_400,
      rawClose,
      adjustedClose: rawClose * adjustedMultiplier,
      close: rawClose * adjustedMultiplier,
      volume: 1_000_000 + index * 100,
    });
  }
  return {
    format: 'investor-control-market-series',
    version: 2,
    symbol: 'TEST',
    providerSymbol: 'TEST',
    source,
    sourceUrl,
    sourceQuality: 'SECONDARY_VALIDATED',
    adjustment: 'ADJUSTED_CLOSE_WHEN_AVAILABLE',
    generatedAt: '2026-08-11T00:00:00.000Z',
    usable: true,
    status: 'ok',
    candles,
  };
}

function canonicalFrom(candidate, count = 120, options = {}) {
  const tail = candidate.candles.slice(-count);
  return {
    format: 'investor-control-market-series',
    version: 2,
    symbol: 'TEST',
    source: options.source || 'Finnhub Historical',
    sourceUrl: options.sourceUrl || 'https://finnhub.io/api/v1/stock/candle',
    sourceQuality: 'PRIMARY_OR_VALIDATED_MARKET',
    usable: true,
    status: 'ok',
    candles: tail.map((candle, index) => ({
      timestamp: candle.timestamp,
      close: candle.rawClose * (options.distortion ? 1 + Math.sin(index / 2) * options.distortion : 1),
      volume: candle.volume,
    })),
  };
}

test('validated long history accepts adjusted research data only after raw-close overlap matches an independent canonical source', () => {
  const candidate = syntheticSeries({ count: 1500, adjustedMultiplier: 0.73 });
  const canonical = canonicalFrom(candidate, 120);
  const result = validateLongHistoryResearchSeries({ candidateSeries: candidate, canonicalSeries: canonical });
  assert.equal(result.status, 'RESEARCH_READY');
  assert.equal(result.researchEligible, true);
  assert.equal(result.decisionEligible, false);
  assert.equal(result.executionEligible, false);
  assert.equal(result.crossCheck.status, 'CROSSCHECK_PASS');
  assert.ok(result.observationCount >= 1260);
  assert.equal(result.series.researchOnly, true);
  assert.equal(result.series.decisionEligible, false);
});

test('long-history cross-check fails closed on material recent return disagreement', () => {
  const candidate = syntheticSeries({ count: 1500 });
  const canonical = canonicalFrom(candidate, 120, { distortion: 0.035 });
  const result = crossCheckLongHistorySeries(candidate, canonical);
  assert.equal(result.researchEligible, false);
  assert.ok(result.blockers.includes('LONG_HISTORY_MEDIAN_RETURN_MISMATCH') || result.blockers.includes('LONG_HISTORY_TAIL_RETURN_MISMATCH') || result.blockers.includes('LONG_HISTORY_CLOSE_SCALE_UNSTABLE'));
});

test('a provider cannot validate its own long-history series as an independent overlap source', () => {
  const candidate = syntheticSeries({ count: 1500 });
  const canonical = canonicalFrom(candidate, 120, {
    source: 'Yahoo Finance Chart',
    sourceUrl: 'https://query2.finance.yahoo.com/v8/finance/chart/TEST',
  });
  const result = crossCheckLongHistorySeries(candidate, canonical);
  assert.equal(result.researchEligible, false);
  assert.ok(result.blockers.includes('INDEPENDENT_CANONICAL_OVERLAP_SOURCE_REQUIRED'));
});

test('multi-year label is rejected when the provider returns too little history', () => {
  const candidate = syntheticSeries({ count: 500 });
  const canonical = canonicalFrom(candidate, 120);
  const result = validateLongHistoryResearchSeries({ candidateSeries: candidate, canonicalSeries: canonical });
  assert.equal(result.status, 'REJECTED');
  assert.ok(result.blockers.includes('LONG_HISTORY_OBSERVATION_COUNT_TOO_SMALL'));
  assert.equal(result.series, null);
});

test('Yahoo long-history acquisition requests max range and remains research-only after validation', async () => {
  const count = 1400;
  const start = 1_600_000_000;
  const raw = [];
  let level = 40;
  for (let index = 0; index < count; index += 1) {
    level *= 1 + 0.0004 + Math.sin(index / 19) * 0.003;
    raw.push(level);
  }
  const timestamps = Array.from({ length: count }, (_, index) => start + index * 86_400);
  let requestedUrl = null;
  const fetchImpl = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      async json() {
        return {
          chart: {
            error: null,
            result: [{
              meta: {
                symbol: 'TEST',
                currency: 'USD',
                exchangeName: 'NYSE',
                instrumentType: 'EQUITY',
              },
              timestamp: timestamps,
              indicators: {
                quote: [{ close: raw, open: raw, high: raw, low: raw, volume: raw.map(() => 1_000_000) }],
                adjclose: [{ adjclose: raw.map((value) => value * 0.95) }],
              },
            }],
          },
        };
      },
    };
  };
  const candidateShape = {
    candles: timestamps.map((timestamp, index) => ({ timestamp, rawClose: raw[index], close: raw[index] * 0.95 })),
  };
  const canonicalSeries = {
    usable: true,
    source: 'Finnhub Historical',
    sourceUrl: 'https://finnhub.io/api/v1/stock/candle',
    candles: candidateShape.candles.slice(-120).map((candle) => ({ timestamp: candle.timestamp, close: candle.rawClose })),
  };
  const result = await fetchLongHistoryResearchSeries('TEST', { fetchImpl, canonicalSeries });
  assert.match(requestedUrl, /range=max/);
  assert.equal(result.status, 'RESEARCH_READY');
  assert.equal(result.researchEligible, true);
  assert.equal(result.decisionEligible, false);
  assert.equal(result.executionEligible, false);
  assert.equal(result.requestedRange, 'max');
});

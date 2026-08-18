import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeForecastDrivers } from '../src/forecast-driver-synthesis.js';

function dossier() {
  return {
    companyId: 'company:ABC',
    invalidationCondition: 'Ακύρωση thesis αν χαθεί ο βασικός καταλύτης ή επιδεινωθεί ουσιωδώς ο ισολογισμός.',
    catalysts: [{ text: 'Επαληθευμένος εταιρικός καταλύτης.', confidence: 0.8, evidenceIds: ['e1', 'e2'] }],
    risks: [{ text: 'Υπάρχει ουσιώδης κίνδυνος εκτέλεσης.', confidence: 0.75, evidenceIds: ['e3'] }],
    readiness: { publishable: true, blockers: [] },
    metrics: {
      crossCheck: { recommendationReady: true, contradictionCount: 0 },
      market: {
        latestTimestamp: 1_780_000_000,
        benchmarkSymbol: 'SPY',
        relativeStrength: { excessReturnPct: 12.5 },
        trend: { distanceFromSma50Pct: 8, distanceFromSma200Pct: 14 },
        risk: { annualizedVolatility60Pct: 42, maxDrawdown120Pct: -18, flags: [] },
        liquidity: { score: 80, averageDailyValueTraded20: 25_000_000 },
        readiness: { priceHistoryReady: true, relativeStrengthReady: true, liquidityReady: true, marketMetricsReady: true },
      },
      fundamentalRisk: {
        metricsReady: true,
        profitability: { netMarginPct: 18, freeCashFlow: 120_000_000 },
        capitalStructure: { dilutedSharesChangePct: 1.2 },
        balanceSheet: { cashRunwayYears: null },
        flags: [],
      },
    },
  };
}

test('driver synthesis exposes measurable supporting and opposing evidence', () => {
  const result = synthesizeForecastDrivers({
    dossier: dossier(),
    opportunity: {
      evidenceQualityScore: 88,
      contradictionCount: 0,
      factors: {
        valuation: { score: 82, verified: true, sourceCount: 3, peerSampleSize: 12, components: { priceToSalesPercentile: 85 } },
        growth: { score: 74, verified: true, sourceCount: 2, peerSampleSize: 12 },
      },
    },
  });
  assert.equal(result.evidenceQualityScore, 88);
  assert.ok(result.drivers.some((item) => item.name === 'VALUATION' && item.direction === 'POSITIVE' && item.verified));
  assert.ok(result.drivers.some((item) => item.name === 'RELATIVE_STRENGTH' && item.direction === 'POSITIVE'));
  assert.ok(result.drivers.some((item) => item.name === 'VERIFIED_CATALYST' && item.evidenceIds.includes('e1')));
  assert.ok(result.drivers.some((item) => item.name === 'VERIFIED_THESIS_RISK' && item.direction === 'NEGATIVE'));
  assert.ok(result.invalidationConditions.length === 1);
});

test('severe volatility, drawdown and dilution are explicit opposing drivers', () => {
  const weak = dossier();
  weak.metrics.market.risk.annualizedVolatility60Pct = 96;
  weak.metrics.market.risk.maxDrawdown120Pct = -58;
  weak.metrics.fundamentalRisk.capitalStructure.dilutedSharesChangePct = 24;
  weak.metrics.fundamentalRisk.flags = ['SEVERE_DILUTION'];
  const result = synthesizeForecastDrivers({ dossier: weak });
  assert.ok(result.drivers.some((item) => item.name === 'VOLATILITY' && item.direction === 'NEGATIVE'));
  assert.ok(result.drivers.some((item) => item.name === 'DRAWDOWN' && item.direction === 'NEGATIVE'));
  assert.ok(result.drivers.some((item) => item.name === 'DILUTION' && item.direction === 'NEGATIVE'));
  assert.ok(result.drivers.some((item) => item.name === 'RISK_SEVERE_DILUTION' && item.strengthScore >= 90));
});

test('absolute valuation is not called cheap without verified peer-normalized valuation evidence', () => {
  const raw = dossier();
  raw.metrics.fundamentalRisk.valuation = { priceToSales: 0.8, priceToBook: 0.5 };
  const result = synthesizeForecastDrivers({ dossier: raw, opportunity: {} });
  assert.equal(result.drivers.some((item) => item.name === 'VALUATION'), false);
  assert.equal(result.invariants.absoluteValuationIsNotCalledCheapWithoutPeerNormalizedEvidence, true);
});

test('unverified factor and readiness gaps remain visible instead of becoming hidden support', () => {
  const incomplete = dossier();
  incomplete.readiness = { publishable: false, blockers: ['FUNDAMENTALS_NOT_READY'] };
  const result = synthesizeForecastDrivers({
    dossier: incomplete,
    opportunity: {
      missingFactors: ['quality'],
      factors: { valuation: { score: 90, verified: false, sourceCount: 1, peerSampleSize: 2 } },
    },
  });
  const valuation = result.drivers.find((item) => item.name === 'VALUATION');
  assert.equal(valuation.verified, false);
  assert.ok(result.unknowns.includes('READINESS:FUNDAMENTALS_NOT_READY'));
  assert.ok(result.unknowns.includes('MISSING_FACTOR:quality'));
});

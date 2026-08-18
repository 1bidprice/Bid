import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrossSectionalRegimeWalkForwardRuntimeStatus } from '../src/forecast-cross-sectional-regime-walk-forward-runtime.js';
import { buildCrossSectionalRegimeWalkForwardOperationalTelemetry, verifyCrossSectionalRegimeWalkForwardProductionSafety } from '../src/forecast-cross-sectional-regime-walk-forward-production-safety.js';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeReport() {
  const status = buildCrossSectionalRegimeWalkForwardRuntimeStatus({ enabled: true, generatedAt: '2026-08-14T00:00:00.000Z', researchDossiers: [], historicalSeriesByCompany: new Map(), benchmarkSeriesByCompany: new Map() });
  return { forecastCrossSectionalRegimeWalkForwardRuntimeStatus: status, operationalHealth: buildCrossSectionalRegimeWalkForwardOperationalTelemetry(status) };
}

test('historical market stack firewall accepts safe research and rejects authority or raw prediction tampering', () => {
  const safe = safeReport();
  assert.equal(verifyCrossSectionalRegimeWalkForwardProductionSafety(safe).status, 'VERIFIED');
  const authority = clone(safe);
  authority.forecastCrossSectionalRegimeWalkForwardRuntimeStatus.research.historicalMarketStackResearch.decisionIntegrationEnabled = true;
  assert.throws(() => verifyCrossSectionalRegimeWalkForwardProductionSafety(authority), /forbidden authority/);
  const raw = clone(safe);
  raw.forecastCrossSectionalRegimeWalkForwardRuntimeStatus.research.historicalMarketStackResearch.rawPredictionsIncluded = true;
  assert.throws(() => verifyCrossSectionalRegimeWalkForwardProductionSafety(raw), /raw predictions forbidden/);
});

test('serialized historical market stack cannot weaken the locked skill floor', () => {
  const report = clone(safeReport());
  const status = report.forecastCrossSectionalRegimeWalkForwardRuntimeStatus;
  const research = status.research;
  const stack = research.historicalMarketStackResearch;
  status.generatedRecordCount = research.generatedRecordCount = 200;
  status.validRegimeRecordCount = research.validRegimeRecordCount = 200;
  Object.assign(stack, { sourceRecordCount: 200, eligibleRecordCount: 200, rejectedRecordCount: 0, predictionCount: 200, skippedInsufficientTrainingCount: 0, modelFitCount: 40, groupCount: 1, predictiveReadyGroupCount: 1, predictiveNotReadyGroupCount: 0 });
  stack.groups = [{
    status: 'HISTORICAL_MARKET_STACK_PREDICTIVE_READY', historicalResearchOnly: true, taxonomyHistoricalBackfillAllowed: false, taxonomyPromotionEligible: false, automaticModelPromotionEnabled: false, probabilityCalibrationEnabled: false, decisionIntegrationEnabled: false, forecastMayInfluenceFinalAction: false, finalActionEligible: false, brokerExecutionEligible: false, decisionImpact: 'NONE', sampleSize: 200, positiveCount: 100, negativeCount: 100,
    ensembleMetrics: { skillVsBaseRatePct: 6, expectedCalibrationError: 0.05 }, brierImprovementVsRawPatternPct: 4, logLossImprovementVsRawPatternPct: 1, eceImprovementVsRawPattern: 0,
    sampleIndependence: { status: 'INDEPENDENCE_READY' }, outcomeWindowIndependence: { status: 'WINDOW_INDEPENDENCE_READY' }, instrumentConcentration: { status: 'INSTRUMENT_DIVERSIFICATION_READY' }, chronologicalStability: { status: 'CHRONOLOGICAL_STABILITY_READY', blocks: [{ ready: true }, { ready: true }, { ready: true }] },
    thresholds: { minimumEvaluationSample: 200, minimumClassCount: 40, minimumSkillPct: 4, maximumEce: 0.08, minimumBrierImprovementPct: 3, minimumLogLossImprovementPct: 0, minimumEceImprovement: -0.01, minimumDistinctForecastDates: 40, minimumDistinctInstruments: 10, maximumSingleForecastDateSharePct: 10, minimumEffectiveNonOverlappingWindows: 12, maximumSingleInstrumentSharePct: 25, minimumEffectiveInstrumentCount: 6, chronologicalBlockCount: 3, minimumChronologicalBlockSample: 20 }, blockers: []
  }];
  report.operationalHealth = buildCrossSectionalRegimeWalkForwardOperationalTelemetry(status);
  assert.throws(() => verifyCrossSectionalRegimeWalkForwardProductionSafety(report), /skill threshold too weak/);
});

test('operational health cannot leak historical market stack research', () => {
  const report = clone(safeReport());
  report.operationalHealth.historicalMarketStackResearch = { predictiveReadyGroupCount: 1 };
  assert.throws(() => verifyCrossSectionalRegimeWalkForwardProductionSafety(report), /raw historical research payload leaked/);
});

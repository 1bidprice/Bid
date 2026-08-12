import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCrossSectionalRegimeWalkForwardRuntimeStatus,
  buildHistoricalWalkForwardRuntimeInstrumentSet,
} from '../src/forecast-cross-sectional-regime-walk-forward-runtime.js';
import {
  buildCrossSectionalRegimeWalkForwardOperationalTelemetry,
  verifyCrossSectionalRegimeWalkForwardProductionSafety,
} from '../src/forecast-cross-sectional-regime-walk-forward-production-safety.js';

function shortSeries(length = 80, symbol = 'SYN') {
  return {
    usable: true,
    source: 'SYNTHETIC_TEST',
    sourceQuality: 'CANONICAL',
    providerSymbol: symbol,
    candles: Array.from({ length }, (_, index) => ({
      timestamp: 1_700_000_000 + index * 86_400,
      open: 100 + index * 0.1,
      high: 101 + index * 0.1,
      low: 99 + index * 0.1,
      close: 100 + index * 0.1,
      volume: 1_000_000,
    })),
  };
}

function dossier(index) {
  return {
    companyId: `company:${index}`,
    instrumentProfile: {
      instrumentId: `instrument:${index}`,
      assetClass: 'EQUITY',
      primaryListing: { symbol: `SYM${index}` },
    },
  };
}

function report(status) {
  return {
    forecastCrossSectionalRegimeWalkForwardRuntimeStatus: status,
    operationalHealth: buildCrossSectionalRegimeWalkForwardOperationalTelemetry(status),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('normal autonomous cadence keeps historical walk-forward fully disabled with zero research work', () => {
  const status = buildCrossSectionalRegimeWalkForwardRuntimeStatus({
    enabled: false,
    generatedAt: '2026-08-13T00:00:00.000Z',
    researchDossiers: [{ get companyId() { throw new Error('disabled cadence must not inspect dossiers'); } }],
  });
  assert.equal(status.executionState, 'DISABLED_BY_CADENCE');
  assert.equal(status.cadenceRequested, false);
  assert.equal(status.research, null);
  assert.equal(status.generatedRecordCount, 0);
  assert.equal(status.networkFetchPerformedByRuntime, false);
  assert.equal(status.liveArchiveEligible, false);
  assert.equal(status.decisionIntegrationEnabled, false);
});

test('runtime instrument selection uses only already-loaded history maps and enforces a hard bound', () => {
  const histories = new Map();
  const benchmarks = new Map();
  const dossiers = Array.from({ length: 8 }, (_, index) => dossier(index));
  for (let index = 0; index < 8; index += 1) {
    histories.set(`company:${index}`, shortSeries(70 + index, `SYM${index}`));
    benchmarks.set(`company:${index}`, shortSeries(90, 'SPY'));
  }
  const set = buildHistoricalWalkForwardRuntimeInstrumentSet({
    researchDossiers: dossiers,
    historicalSeriesByCompany: histories,
    benchmarkSeriesByCompany: benchmarks,
    maximumInstrumentCount: 3,
  });
  assert.equal(set.eligibleInstrumentCount, 8);
  assert.equal(set.selectedInstrumentCount, 3);
  assert.equal(set.omittedInstrumentCount, 5);
  assert.equal(set.maximumInstrumentCount, 3);
  assert.deepEqual(set.selectedInstruments.map((item) => item.companyId), ['company:7', 'company:6', 'company:5']);
});

test('enabled cadence with insufficient cached history fails closed without any new network request', () => {
  const histories = new Map([['company:1', shortSeries(80, 'SYM1')]]);
  const benchmarks = new Map([['company:1', shortSeries(80, 'SPY')]]);
  const status = buildCrossSectionalRegimeWalkForwardRuntimeStatus({
    enabled: true,
    generatedAt: '2026-08-13T00:00:00.000Z',
    researchDossiers: [dossier(1)],
    historicalSeriesByCompany: histories,
    benchmarkSeriesByCompany: benchmarks,
    maximumInstrumentCount: 8,
  });
  assert.equal(status.executionState, 'ENABLED_RESEARCH_ONLY');
  assert.equal(status.selectedInstrumentCount, 1);
  assert.equal(status.generatedRecordCount, 0);
  assert.equal(status.readyGroupCount, 0);
  assert.equal(status.rawHistoricalRecordExported, false);
  assert.equal(status.networkFetchPerformedByRuntime, false);
  assert.deepEqual(status.research.auditSampleRecords, []);
  assert.equal(Object.prototype.hasOwnProperty.call(status.research, 'researchRecords'), false);
});

test('production firewall accepts both safe disabled and safe enabled research-only runtime states', () => {
  const disabled = buildCrossSectionalRegimeWalkForwardRuntimeStatus({ enabled: false, generatedAt: '2026-08-13T00:00:00.000Z' });
  assert.equal(verifyCrossSectionalRegimeWalkForwardProductionSafety(report(disabled)).status, 'VERIFIED');

  const enabled = buildCrossSectionalRegimeWalkForwardRuntimeStatus({
    enabled: true,
    generatedAt: '2026-08-13T00:00:00.000Z',
    researchDossiers: [dossier(1)],
    historicalSeriesByCompany: new Map([['company:1', shortSeries(80, 'SYM1')]]),
    benchmarkSeriesByCompany: new Map([['company:1', shortSeries(80, 'SPY')]]),
  });
  assert.equal(verifyCrossSectionalRegimeWalkForwardProductionSafety(report(enabled)).status, 'VERIFIED');
});

test('production firewall rejects network, raw-export, live-calibration, decision and broker authority tampering', () => {
  const base = report(buildCrossSectionalRegimeWalkForwardRuntimeStatus({ enabled: false, generatedAt: '2026-08-13T00:00:00.000Z' }));

  const network = clone(base);
  network.forecastCrossSectionalRegimeWalkForwardRuntimeStatus.networkFetchPerformedByRuntime = true;
  assert.throws(() => verifyCrossSectionalRegimeWalkForwardProductionSafety(network), /network fetch forbidden/);

  const raw = clone(base);
  raw.forecastCrossSectionalRegimeWalkForwardRuntimeStatus.rawHistoricalRecordExported = true;
  assert.throws(() => verifyCrossSectionalRegimeWalkForwardProductionSafety(raw), /raw historical record export forbidden/);

  const live = clone(base);
  live.forecastCrossSectionalRegimeWalkForwardRuntimeStatus.liveCalibrationEligible = true;
  assert.throws(() => verifyCrossSectionalRegimeWalkForwardProductionSafety(live), /forbidden authority/);

  const decision = clone(base);
  decision.forecastCrossSectionalRegimeWalkForwardRuntimeStatus.decisionIntegrationEnabled = true;
  assert.throws(() => verifyCrossSectionalRegimeWalkForwardProductionSafety(decision), /forbidden authority/);

  const broker = clone(base);
  broker.forecastCrossSectionalRegimeWalkForwardRuntimeStatus.brokerExecutionEligible = true;
  assert.throws(() => verifyCrossSectionalRegimeWalkForwardProductionSafety(broker), /forbidden authority/);
});

test('production firewall rejects compact telemetry tampering and never leaks nested research into operational health', () => {
  const status = buildCrossSectionalRegimeWalkForwardRuntimeStatus({ enabled: false, generatedAt: '2026-08-13T00:00:00.000Z' });
  const safe = report(status);
  assert.equal(JSON.stringify(safe.operationalHealth).includes('instrumentSummaries'), false);
  assert.equal(JSON.stringify(safe.operationalHealth).includes('calibration'), false);

  const tampered = clone(safe);
  tampered.operationalHealth.forecastHistoricalWalkForwardGeneratedRecordCount = 99;
  assert.throws(() => verifyCrossSectionalRegimeWalkForwardProductionSafety(tampered), /telemetry mismatch/);
});

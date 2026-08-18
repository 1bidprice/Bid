import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateOosTaxonomyConcentration,
  forecastNativeTaxonomyCluster,
} from '../src/forecast-oos-taxonomy-concentration.js';

const FORECAST_AT = '2026-08-12T00:00:00.000Z';

function secSnapshot(index, majorGroup = '60', options = {}) {
  const companyId = options.companyId || `company:sec:${index}`;
  const instrumentId = options.instrumentId || `instrument:sec:${index}`;
  const cik = String(index + 1).padStart(10, '0');
  const code = `${majorGroup}${String(index % 100).padStart(2, '0')}`;
  return {
    contract: 'FORECAST_TIME_CLASSIFICATION_SNAPSHOT_V1',
    policyVersion: '2026-08-11.1',
    companyId,
    instrumentId,
    sourceAuthority: 'SEC_EDGAR_SUBMISSIONS',
    sourceUrl: `https://data.sec.gov/submissions/CIK${cik}.json`,
    sourceDocumentId: `CIK${cik}`,
    capturedAt: options.capturedAt || FORECAST_AT,
    taxonomy: 'SEC_SIC',
    code,
    description: options.description || `Synthetic SIC ${code}`,
    inferenceUsed: false,
    decisionImpact: 'NONE',
  };
}

function athensSnapshot(index, sector = 'Banks', subSector = 'Banks', options = {}) {
  const companyId = options.companyId || `company:xath:${index}`;
  const instrumentId = options.instrumentId || `instrument:xath:${index}`;
  const issuerId = String(1000 + index);
  return {
    contract: 'FORECAST_TIME_CLASSIFICATION_SNAPSHOT_V1',
    policyVersion: '2026-08-11.1',
    companyId,
    instrumentId,
    sourceAuthority: 'EURONEXT_ATHENS_ISSUER_PROFILE',
    sourceUrl: `https://athens.euronext.com/en/market-data/issuers/${issuerId}`,
    sourceDocumentId: `EURONEXT_ATHENS_ISSUER_${issuerId}`,
    capturedAt: options.capturedAt || FORECAST_AT,
    taxonomy: 'FTSE_RUSSELL_ICB',
    sector,
    subSector,
    description: `${sector} / ${subSector}`,
    inferenceUsed: false,
    decisionImpact: 'NONE',
  };
}

function record(index, snapshot, options = {}) {
  return {
    forecastId: `taxonomy:${index}`,
    companyId: snapshot?.companyId || options.companyId || `company:missing:${index}`,
    instrumentId: snapshot?.instrumentId || options.instrumentId || `instrument:missing:${index}`,
    forecastAt: options.forecastAt || FORECAST_AT,
    classificationSnapshot: snapshot || null,
  };
}

test('SEC SIC uses the native two-digit major group rather than description inference', () => {
  const snapshot = secSnapshot(1, '60', { description: 'Banks' });
  const cluster = forecastNativeTaxonomyCluster(snapshot);
  assert.deepEqual(cluster, {
    taxonomy: 'SEC_SIC',
    clusterLevel: 'SIC_MAJOR_GROUP',
    clusterKey: 'SEC_SIC_MAJOR_GROUP:60',
    clusterLabel: 'SIC major group 60',
  });
});

test('Athens ICB uses the exact forecast-time published sector as its native cluster', () => {
  const snapshot = athensSnapshot(1, 'Travel & Leisure', 'Casinos & Gambling');
  const cluster = forecastNativeTaxonomyCluster(snapshot);
  assert.equal(cluster.taxonomy, 'FTSE_RUSSELL_ICB');
  assert.equal(cluster.clusterLevel, 'ICB_SECTOR');
  assert.equal(cluster.clusterKey, 'FTSE_RUSSELL_ICB_SECTOR:Travel & Leisure');
  assert.equal(cluster.clusterLabel, 'Travel & Leisure');
});

test('identical descriptive text in SEC and ICB never creates a cross-taxonomy cluster', () => {
  const sec = forecastNativeTaxonomyCluster(secSnapshot(2, '60', { description: 'Banks' }));
  const icb = forecastNativeTaxonomyCluster(athensSnapshot(2, 'Banks', 'Banks'));
  assert.notEqual(sec.clusterKey, icb.clusterKey);
  assert.notEqual(sec.taxonomy, icb.taxonomy);
});

test('well-covered material SEC and Athens taxonomies can both pass independently', () => {
  const secGroups = ['10', '20', '30', '40'];
  const icbSectors = ['Banks', 'Utilities', 'Technology'];
  const records = [
    ...Array.from({ length: 70 }, (_, index) => record(index, secSnapshot(index, secGroups[index % secGroups.length]))),
    ...Array.from({ length: 30 }, (_, offset) => {
      const index = 100 + offset;
      const sector = icbSectors[offset % icbSectors.length];
      return record(index, athensSnapshot(index, sector, `${sector} Sub-sector`));
    }),
  ];
  const result = evaluateOosTaxonomyConcentration(records);
  assert.equal(result.status, 'TAXONOMY_DIVERSIFICATION_READY');
  assert.equal(result.classificationCoveragePct, 100);
  assert.equal(result.materialTaxonomyCount, 2);
  assert.equal(result.crossTaxonomyMappingUsed, false);
  assert.equal(result.inferenceUsed, false);
  assert.ok(result.taxonomies.every((item) => item.status === 'TAXONOMY_DIVERSIFICATION_READY'));
});

test('insufficient classification coverage blocks promotion even when classified records are diversified', () => {
  const groups = ['10', '20', '30', '40'];
  const classified = Array.from({ length: 70 }, (_, index) => record(index, secSnapshot(index, groups[index % groups.length])));
  const missing = Array.from({ length: 30 }, (_, offset) => record(100 + offset, null));
  const result = evaluateOosTaxonomyConcentration([...classified, ...missing]);
  assert.equal(result.classificationCoveragePct, 70);
  assert.equal(result.status, 'TAXONOMY_DIVERSIFICATION_NOT_READY');
  assert.ok(result.blockers.includes('OOS_CLASSIFICATION_COVERAGE_TOO_LOW'));
});

test('a material taxonomy dominated by one native cluster is rejected', () => {
  const records = Array.from({ length: 100 }, (_, index) => record(index, secSnapshot(index, '60')));
  const result = evaluateOosTaxonomyConcentration(records);
  const sec = result.taxonomies.find((item) => item.taxonomy === 'SEC_SIC');
  assert.equal(result.status, 'TAXONOMY_DIVERSIFICATION_NOT_READY');
  assert.equal(sec.maximumSingleNativeClusterSharePct, 100);
  assert.equal(sec.effectiveNativeClusterCount, 1);
  assert.ok(sec.blockers.includes('OOS_NATIVE_CLUSTER_CONCENTRATION_TOO_HIGH'));
  assert.ok(sec.blockers.includes('OOS_EFFECTIVE_NATIVE_CLUSTER_COUNT_TOO_SMALL'));
});

test('strict governance thresholds require broad native clusters separately in each material taxonomy', () => {
  const secGroups = ['10', '20', '30', '40', '50'];
  const icbSectors = ['Banks', 'Utilities', 'Technology', 'Travel & Leisure'];
  const records = [
    ...Array.from({ length: 320 }, (_, index) => record(index, secSnapshot(index, secGroups[index % secGroups.length]))),
    ...Array.from({ length: 80 }, (_, offset) => {
      const index = 1000 + offset;
      const sector = icbSectors[offset % icbSectors.length];
      return record(index, athensSnapshot(index, sector, `${sector} Sub-sector`));
    }),
  ];
  const result = evaluateOosTaxonomyConcentration(records, {
    minimumClassificationCoveragePct: 90,
    materialTaxonomyMinimumSharePct: 15,
    materialTaxonomyMinimumRecordCount: 50,
    maximumSingleNativeClusterSharePct: 30,
    minimumEffectiveNativeClusterCount: 4,
  });
  assert.equal(result.status, 'TAXONOMY_DIVERSIFICATION_READY');
  assert.equal(result.materialTaxonomyCount, 2);
  assert.ok(result.taxonomies.every((item) => item.effectiveNativeClusterCount >= 4));
  assert.ok(result.taxonomies.every((item) => item.maximumSingleNativeClusterSharePct <= 30));
});

test('classification captured after the forecast is excluded and blocks the gate', () => {
  const snapshot = secSnapshot(1, '60', { capturedAt: '2026-08-13T00:00:00.000Z' });
  const result = evaluateOosTaxonomyConcentration([record(1, snapshot)]);
  assert.equal(result.invalidClassificationSnapshotCount, 1);
  assert.equal(result.validClassificationRecordCount, 0);
  assert.equal(result.status, 'TAXONOMY_DIVERSIFICATION_NOT_READY');
  assert.ok(result.blockers.includes('OOS_INVALID_CLASSIFICATION_SNAPSHOTS_EXCLUDED'));
});

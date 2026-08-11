import { validateForecastClassificationSnapshot } from './forecast-classification-lineage.js';

export const FORECAST_OOS_TAXONOMY_CONCENTRATION_VERSION = '2026-08-12.1';

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function normalizedText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

export function forecastNativeTaxonomyCluster(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  if (snapshot.taxonomy === 'SEC_SIC') {
    const code = String(snapshot.code || '').trim();
    if (!/^\d{4}$/.test(code)) return null;
    const majorGroup = code.slice(0, 2);
    return {
      taxonomy: 'SEC_SIC',
      clusterLevel: 'SIC_MAJOR_GROUP',
      clusterKey: `SEC_SIC_MAJOR_GROUP:${majorGroup}`,
      clusterLabel: `SIC major group ${majorGroup}`,
    };
  }
  if (snapshot.taxonomy === 'FTSE_RUSSELL_ICB') {
    const sector = normalizedText(snapshot.sector);
    if (!sector) return null;
    return {
      taxonomy: 'FTSE_RUSSELL_ICB',
      clusterLevel: 'ICB_SECTOR',
      clusterKey: `FTSE_RUSSELL_ICB_SECTOR:${sector}`,
      clusterLabel: sector,
    };
  }
  return null;
}

function taxonomySummary(taxonomy, records, classifiedCount, thresholds) {
  const clusterCounts = new Map();
  for (const item of records) {
    clusterCounts.set(item.cluster.clusterKey, (clusterCounts.get(item.cluster.clusterKey) || 0) + 1);
  }

  let mostConcentratedCluster = null;
  let maximumClusterCount = 0;
  let concentrationSumSquares = 0;
  for (const [clusterKey, count] of clusterCounts.entries()) {
    if (count > maximumClusterCount) {
      maximumClusterCount = count;
      mostConcentratedCluster = clusterKey;
    }
    const share = records.length ? count / records.length : 0;
    concentrationSumSquares += share * share;
  }

  const taxonomySharePct = classifiedCount ? (records.length / classifiedCount) * 100 : 0;
  const maximumSingleClusterSharePct = records.length ? (maximumClusterCount / records.length) * 100 : 0;
  const effectiveNativeClusterCount = concentrationSumSquares > 0 ? 1 / concentrationSumSquares : 0;
  const material = taxonomySharePct >= thresholds.materialTaxonomyMinimumSharePct;
  const blockers = [];
  if (material && records.length < thresholds.materialTaxonomyMinimumRecordCount) {
    blockers.push('OOS_MATERIAL_TAXONOMY_SAMPLE_TOO_SMALL');
  }
  if (material && maximumSingleClusterSharePct > thresholds.maximumSingleNativeClusterSharePct) {
    blockers.push('OOS_NATIVE_CLUSTER_CONCENTRATION_TOO_HIGH');
  }
  if (material && effectiveNativeClusterCount < thresholds.minimumEffectiveNativeClusterCount) {
    blockers.push('OOS_EFFECTIVE_NATIVE_CLUSTER_COUNT_TOO_SMALL');
  }

  return {
    taxonomy,
    clusterLevel: records[0]?.cluster?.clusterLevel || null,
    recordCount: records.length,
    taxonomySharePct: round(taxonomySharePct),
    material,
    distinctNativeClusterCount: clusterCounts.size,
    mostConcentratedCluster,
    maximumSingleNativeClusterCount: maximumClusterCount,
    maximumSingleNativeClusterSharePct: round(maximumSingleClusterSharePct),
    effectiveNativeClusterCount: round(effectiveNativeClusterCount),
    status: !material ? 'NON_MATERIAL_TAXONOMY' : blockers.length ? 'TAXONOMY_DIVERSIFICATION_NOT_READY' : 'TAXONOMY_DIVERSIFICATION_READY',
    blockers,
  };
}

export function evaluateOosTaxonomyConcentration(records = [], options = {}) {
  const sample = Array.isArray(records) ? records : [];
  const thresholds = {
    minimumClassificationCoveragePct: boundedNumber(options.minimumClassificationCoveragePct, 80, 0, 100),
    materialTaxonomyMinimumSharePct: boundedNumber(options.materialTaxonomyMinimumSharePct, 15, 0.1, 100),
    materialTaxonomyMinimumRecordCount: Math.round(boundedNumber(options.materialTaxonomyMinimumRecordCount, 30, 1, 1000000)),
    maximumSingleNativeClusterSharePct: boundedNumber(options.maximumSingleNativeClusterSharePct, 40, 0.1, 100),
    minimumEffectiveNativeClusterCount: boundedNumber(options.minimumEffectiveNativeClusterCount, 3, 1, 100000),
  };

  const byTaxonomy = new Map();
  let validClassificationRecordCount = 0;
  let unclassifiedRecordCount = 0;
  let invalidClassificationSnapshotCount = 0;
  let nativeClusterMissingCount = 0;

  for (const record of sample) {
    const snapshot = record?.classificationSnapshot;
    if (!snapshot) {
      unclassifiedRecordCount += 1;
      continue;
    }
    const validation = validateForecastClassificationSnapshot(snapshot, record);
    if (!validation.ok) {
      invalidClassificationSnapshotCount += 1;
      continue;
    }
    const cluster = forecastNativeTaxonomyCluster(snapshot);
    if (!cluster) {
      nativeClusterMissingCount += 1;
      continue;
    }
    validClassificationRecordCount += 1;
    const items = byTaxonomy.get(cluster.taxonomy) || [];
    items.push({ record, snapshot, cluster });
    byTaxonomy.set(cluster.taxonomy, items);
  }

  const classificationCoveragePct = sample.length ? (validClassificationRecordCount / sample.length) * 100 : 0;
  const taxonomies = [...byTaxonomy.entries()]
    .map(([taxonomy, items]) => taxonomySummary(taxonomy, items, validClassificationRecordCount, thresholds))
    .sort((a, b) => a.taxonomy.localeCompare(b.taxonomy));
  const materialTaxonomies = taxonomies.filter((item) => item.material);

  const blockers = [];
  if (!sample.length) blockers.push('OOS_TAXONOMY_CONCENTRATION_SAMPLE_EMPTY');
  if (invalidClassificationSnapshotCount > 0) blockers.push('OOS_INVALID_CLASSIFICATION_SNAPSHOTS_EXCLUDED');
  if (nativeClusterMissingCount > 0) blockers.push('OOS_NATIVE_CLUSTER_IDENTITY_MISSING');
  if (classificationCoveragePct < thresholds.minimumClassificationCoveragePct) blockers.push('OOS_CLASSIFICATION_COVERAGE_TOO_LOW');
  if (validClassificationRecordCount > 0 && materialTaxonomies.length === 0) blockers.push('OOS_NO_MATERIAL_CLASSIFICATION_TAXONOMY');
  for (const taxonomy of materialTaxonomies) blockers.push(...taxonomy.blockers);

  const uniqueBlockers = [...new Set(blockers)];
  return {
    contract: 'OOS_TAXONOMY_NATIVE_CONCENTRATION_V1',
    policyVersion: FORECAST_OOS_TAXONOMY_CONCENTRATION_VERSION,
    status: uniqueBlockers.length ? 'TAXONOMY_DIVERSIFICATION_NOT_READY' : 'TAXONOMY_DIVERSIFICATION_READY',
    sampleSize: sample.length,
    validClassificationRecordCount,
    unclassifiedRecordCount,
    invalidClassificationSnapshotCount,
    nativeClusterMissingCount,
    classificationCoveragePct: round(classificationCoveragePct),
    taxonomyCount: taxonomies.length,
    materialTaxonomyCount: materialTaxonomies.length,
    thresholds,
    taxonomies,
    blockers: uniqueBlockers,
    crossTaxonomyMappingUsed: false,
    inferenceUsed: false,
    decisionImpact: 'NONE',
  };
}

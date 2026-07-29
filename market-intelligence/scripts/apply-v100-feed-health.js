import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/mobile-intelligence-feed.js');
let source = fs.readFileSync(file, 'utf8');

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.0.0 feed health patch failed: missing ${label}`);
  return content.replace(from, to);
}

source = replaceRequired(
  source,
  "    HISTORICAL_MARKET_METRICS_REQUIRED: 'Λείπει επαρκές ιστορικό τιμής και όγκου',",
  "    HISTORICAL_MARKET_METRICS_REQUIRED: 'Λείπει επαρκές ιστορικό τιμής και όγκου',\n    MARKET_METRICS_NOT_READY: 'Δεν έχουν ολοκληρωθεί οι έλεγχοι ιστορικού αγοράς',\n    MARKET_HISTORY_SOURCE_NOT_READY: 'Η πηγή ιστορικών δεδομένων δεν έχει εγκριθεί',\n    MARKET_HISTORY_NOT_CROSSCHECKED: 'Το ιστορικό τιμών δεν έχει διασταυρωθεί με ανεξάρτητη τρέχουσα τιμή',\n    MARKET_BENCHMARK_NOT_READY: 'Λείπει έγκυρο συγκριτικό σημείο αναφοράς αγοράς',",
  'professional market blocker labels',
);

source = replaceRequired(
  source,
  "    sourceSelection: report.discovery?.sourcePolicy || null,\n    summary:",
  "    sourceSelection: report.discovery?.sourcePolicy || null,\n    operationalHealth: {\n      ...(report.operationalHealth || {}),\n      status: (report.historicalMarketMetrics || []).some((item) => item?.readiness?.marketMetricsReady === true) && Number(report.marketSnapshotCount || 0) > 0 ? 'OPERATIONAL' : 'DEGRADED',\n      generatedAt: report.operationalHealth?.generatedAt || generatedAt,\n      staleOutput: false,\n    },\n    sourceHealth: {\n      evidenceCount: Number(report.evidenceCount || 0),\n      documentReviewedCount: Number(report.documentReviewedCount || 0),\n      independentDiscoveryCount: Number(report.independentDiscoveryCount || 0),\n      fundamentalSnapshotCount: Number(report.fundamentalSnapshotCount || 0),\n      marketSnapshotCount: Number(report.marketSnapshotCount || 0),\n      historicalMarketMetricsCount: Number(report.historicalMarketMetricsCount || 0),\n      readyHistoricalMarketMetricsCount: (report.historicalMarketMetrics || []).filter((item) => item?.readiness?.marketMetricsReady === true).length,\n      diagnosticCount: Number((report.diagnostics || []).length + (report.discovery?.diagnostics || []).length),\n    },\n    summary:",
  'operational health feed fields',
);

fs.writeFileSync(file, source);

const schemaPath = path.join(root, 'schemas/mobile-intelligence-feed.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
for (const key of ['operationalHealth', 'sourceHealth']) {
  if (!schema.required.includes(key)) schema.required.splice(schema.required.indexOf('summary'), 0, key);
}
schema.properties.operationalHealth = {
  type: 'object',
  additionalProperties: true,
  required: ['status', 'generatedAt', 'staleOutput'],
  properties: {
    status: { type: 'string', enum: ['OPERATIONAL', 'DEGRADED'] },
    generatedAt: { type: 'string', format: 'date-time' },
    staleOutput: { type: 'boolean' },
  },
};
schema.properties.sourceHealth = {
  type: 'object',
  additionalProperties: false,
  required: [
    'evidenceCount', 'documentReviewedCount', 'independentDiscoveryCount', 'fundamentalSnapshotCount',
    'marketSnapshotCount', 'historicalMarketMetricsCount', 'readyHistoricalMarketMetricsCount', 'diagnosticCount',
  ],
  properties: Object.fromEntries([
    'evidenceCount', 'documentReviewedCount', 'independentDiscoveryCount', 'fundamentalSnapshotCount',
    'marketSnapshotCount', 'historicalMarketMetricsCount', 'readyHistoricalMarketMetricsCount', 'diagnosticCount',
  ].map((key) => [key, { type: 'integer', minimum: 0 }])),
};
fs.writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);

console.log('Investor Control v1.0.0 mobile feed operational health and schema applied.');

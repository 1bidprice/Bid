import fs from 'node:fs';
import path from 'node:path';
import { mergeForecastOutcomeArchives } from '../src/forecast-outcome-archive.js';

function readArchive(filePath, { optional = false } = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return null;
    throw error;
  }
}

const basePath = path.resolve(process.cwd(), process.argv[2] || 'forecast-outcome-ledger.json');
const incomingPath = path.resolve(process.cwd(), process.argv[3] || 'out/forecast-outcome-ledger.json');
const outputPath = path.resolve(process.cwd(), process.argv[4] || basePath);
const base = readArchive(basePath, { optional: true });
const incoming = readArchive(incomingPath);
const merged = mergeForecastOutcomeArchives(base, incoming, { updatedAt: new Date().toISOString() });
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  forecastOutcomeArchiveMerge: 'PASS',
  baseRecordCount: base?.records?.length || 0,
  incomingRecordCount: incoming?.records?.length || 0,
  mergedRecordCount: merged.records.length,
  maturedCount: merged.summary.maturedCount,
  openCount: merged.summary.openCount,
}, null, 2));

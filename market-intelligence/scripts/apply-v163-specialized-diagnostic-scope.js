import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/adapters/euronext-athens-fundamentals.js');
let source = fs.readFileSync(filePath, 'utf8');

const from = `      numericSemanticsPolicy: 'FINANCIAL_TABLE_NUMBER_V1',
      metricRejectionAudit,`;
const to = `      numericSemanticsPolicy: 'FINANCIAL_TABLE_NUMBER_V1',
      // The rejection audit diagnoses the generic operating-company extractor.
      // Specialized instruments keep their raw facts but must not expose
      // irrelevant generic-metric rejection noise.
      metricRejectionAudit: genericModelEligible ? metricRejectionAudit : {},`;

if (!source.includes(to)) {
  if (!source.includes(from)) throw new Error('v1.6.3 diagnostic-scope patch failed: quality audit output not found');
  source = source.replace(from, to);
}

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'metricRejectionAudit: genericModelEligible ? metricRejectionAudit : {}',
  'specializedModelRequired: model.specializedModelRequired',
  'genericMetricsSuppressed: !genericModelEligible',
  'boundedMetricRejectionAudit',
  'normalizePdfGlyphs',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.6.3 diagnostic-scope verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.6.3 specialized-model diagnostic scoping applied.');

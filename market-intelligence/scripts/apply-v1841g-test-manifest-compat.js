import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'test/forecast-cross-sectional-regime-walk-forward-runtime-integration.test.js',
  'test/forecast-regime-factor-governance-runtime.test.js',
  'test/forecast-stacked-ensemble-production-safety.test.js',
  'test/v180-factor-production-observability-runtime.test.js',
];

for (const relative of files) {
  const absolute = path.join(root, relative);
  let source = fs.readFileSync(absolute, 'utf8');

  source = source.replace(
    /\s*assert\.equal\(manifest\.testPatches\.at\(-1\),\s*'apply-v[^']+'\);/g,
    "\n  assert.ok(manifest.testPatches.includes('apply-v1823-cross-sectional-regime-walk-forward-runtime.js'));\n  assert.ok(manifest.testPatches.indexOf('apply-v1823-cross-sectional-regime-walk-forward-runtime.js') < manifest.testPatches.indexOf('apply-v1841b-research-integrity.js'));",
  );
  source = source.replace(
    /\s*assert\.equal\(manifest\.buildPatches\.at\(-1\),\s*'apply-v[^']+'\);/g,
    "\n  assert.ok(manifest.buildPatches.includes('apply-v1823-cross-sectional-regime-walk-forward-runtime.js'));\n  assert.ok(manifest.buildPatches.indexOf('apply-v1823-cross-sectional-regime-walk-forward-runtime.js') < manifest.buildPatches.indexOf('apply-v1841b-research-integrity.js'));",
  );
  source = source.replace(
    /assert\.equal\(new Set\(manifest\.testPatches\)\.size,\s*\d+\);/g,
    'assert.equal(new Set(manifest.testPatches).size, manifest.testPatches.length);',
  );
  source = source.replace(
    /assert\.equal\(new Set\(manifest\.buildPatches\)\.size,\s*\d+\);/g,
    'assert.equal(new Set(manifest.buildPatches).size, manifest.buildPatches.length);',
  );

  if (!source.includes("apply-v1841b-research-integrity.js")) {
    throw new Error(`v1.8.4 test manifest compatibility failed: ${relative}`);
  }
  fs.writeFileSync(absolute, source);
}

console.log('Investor Control v1.8.4 legacy runtime manifest tests updated for ordered later migrations.');

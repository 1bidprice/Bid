#!/usr/bin/env bash
set -euo pipefail

BRANCH='investor-control-core-stabilization-v174'
BASE_SHA="${1:-${GITHUB_SHA:-}}"
if [[ -z "$BASE_SHA" ]]; then
  echo 'Missing triggering SHA.' >&2
  exit 1
fi

REMOTE_SHA="$(git rev-parse HEAD)"
if [[ "$REMOTE_SHA" != "$BASE_SHA" ]]; then
  echo "Unexpected checkout head: expected=$BASE_SHA actual=$REMOTE_SHA" >&2
  exit 1
fi

# First prove the historical materializer still yields a passing, deterministic runtime.
(
  cd market-intelligence
  npm test
)

python3 - <<'PY'
import json
from pathlib import Path

root = Path('market-intelligence')
package_path = root / 'package.json'
pkg = json.loads(package_path.read_text())
pkg['scripts'] = {
    'test': 'node scripts/verify-canonical-source.js && node --test',
    'run:daily': 'node src/run-daily-intelligence.js out/daily-intelligence.json',
    'run:autonomous': 'node src/run-autonomous-intelligence.js out/autonomous-intelligence.json',
    'build:mobile': 'node src/build-mobile-feed.js out/daily-intelligence.json out/mobile-intelligence-feed.json',
    'build:autonomous-mobile': 'node src/build-mobile-feed.js out/autonomous-intelligence.json out/mobile-intelligence-feed.json',
    'publish:reviewed': 'node src/publish-reviewed-research.js out/daily-intelligence.json config/review-decisions.json out/reviewed-publication.json',
}
package_path.write_text(json.dumps(pkg, indent=2, ensure_ascii=False) + '\n')

# Four legacy tests asserted that runtime patches existed. Convert them to the permanent
# canonical invariant: the source is already materialized and direct entrypoints are used.
path_tests = [
    root / 'test/forecast-cross-sectional-regime-walk-forward-runtime-integration.test.js',
    root / 'test/forecast-regime-factor-governance-runtime.test.js',
    root / 'test/forecast-stacked-ensemble-production-safety.test.js',
]
for path in path_tests:
    text = path.read_text()
    old = "  const manifest = JSON.parse(read('config/runtime-release-manifest.json'));\n"
    if old not in text:
        raise SystemExit(f'Expected legacy manifest assertion missing: {path}')
    text = text.replace(old, "  const pkg = JSON.parse(read('package.json'));\n", 1)
    text = '\n'.join(line for line in text.splitlines() if 'manifest.' not in line) + '\n'
    marker = "  const verifier = read('scripts/verify-production-output.js');\n"
    replacement = marker + "\n" + \
        "  assert.equal(pkg.version, '1.8.0');\n" + \
        "  assert.equal(fs.existsSync(path.join(root, 'config/runtime-release-manifest.json')), false);\n" + \
        "  assert.equal(fs.existsSync(path.join(root, 'scripts/run-current-release.js')), false);\n" + \
        "  assert.doesNotMatch(pkg.scripts.test, /run-current-release|apply-v/i);\n" + \
        "  assert.equal(pkg.scripts['run:autonomous'], 'node src/run-autonomous-intelligence.js out/autonomous-intelligence.json');\n"
    if marker not in text:
        raise SystemExit(f'Expected verifier marker missing: {path}')
    path.write_text(text.replace(marker, replacement, 1))

path = root / 'test/v180-factor-production-observability-runtime.test.js'
text = path.read_text()
old = "  const manifest = JSON.parse(fs.readFileSync(new URL('config/runtime-release-manifest.json', root), 'utf8'));\n"
if old not in text:
    raise SystemExit(f'Expected legacy manifest assertion missing: {path}')
text = text.replace(old, "  const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));\n", 1)
text = '\n'.join(line for line in text.splitlines() if 'manifest.' not in line) + '\n'
marker = "  assert.match(verifier, /factorResearchGovernanceSafety: 'REQUIRED'/);\n"
replacement = marker + "\n" + \
    "  assert.equal(pkg.version, '1.8.0');\n" + \
    "  assert.equal(fs.existsSync(new URL('config/runtime-release-manifest.json', root)), false);\n" + \
    "  assert.equal(fs.existsSync(new URL('scripts/run-current-release.js', root)), false);\n" + \
    "  assert.doesNotMatch(pkg.scripts.test, /run-current-release|apply-v/i);\n" + \
    "  assert.equal(pkg.scripts['run:autonomous'], 'node src/run-autonomous-intelligence.js out/autonomous-intelligence.json');\n"
if marker not in text:
    raise SystemExit(f'Expected factor safety marker missing: {path}')
path.write_text(text.replace(marker, replacement, 1))

verifier = root / 'scripts/verify-canonical-source.js'
verifier.write_text("""import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const forbiddenScripts = Object.entries(pkg.scripts || {}).filter(([, command]) => /run-current-release|apply-v/i.test(String(command)));
if (forbiddenScripts.length) throw new Error(`canonical source: runtime patch command remains in package scripts: ${forbiddenScripts.map(([name]) => name).join(', ')}`);
for (const legacy of ['config/runtime-release-manifest.json', 'scripts/run-current-release.js']) {
  if (fs.existsSync(path.join(root, legacy))) throw new Error(`canonical source: legacy runtime materializer remains: ${legacy}`);
}
const scriptDir = path.join(root, 'scripts');
const patchFiles = fs.readdirSync(scriptDir).filter((name) => /^apply-v.*\\.js$/i.test(name));
if (patchFiles.length) throw new Error(`canonical source: historical apply-v scripts remain (${patchFiles.length})`);
for (const folder of ['src', 'config']) {
  const start = path.join(root, folder);
  const stack = fs.existsSync(start) ? [start] : [];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (/\\.(?:js|json)$/i.test(entry.name)) {
        const text = fs.readFileSync(absolute, 'utf8');
        if (/run-current-release|scripts\\/apply-v/i.test(text)) throw new Error(`canonical source: runtime patch dependency remains in ${path.relative(root, absolute)}`);
      }
    }
  }
}
console.log(JSON.stringify({
  canonicalMarketIntelligenceSource: 'VERIFIED',
  runtimePatchRunnerPresent: false,
  runtimePatchManifestPresent: false,
  applyPatchFileCount: 0,
  directEntrypoints: Object.keys(pkg.scripts || {}),
}, null, 2));
""")

(root / 'config/runtime-release-manifest.json').unlink(missing_ok=True)
(root / 'scripts/run-current-release.js').unlink(missing_ok=True)
for patch in (root / 'scripts').glob('apply-v*.js'):
    patch.unlink()
PY

# Permanent patch-free source verification and full parity suite.
(
  cd market-intelligence
  node scripts/verify-canonical-source.js
  npm test
)

git diff --check
if find market-intelligence/scripts -maxdepth 1 -type f -name 'apply-v*.js' -print -quit | grep -q .; then
  echo 'Historical apply-v patch remains.' >&2
  exit 1
fi
test ! -e market-intelligence/config/runtime-release-manifest.json
test ! -e market-intelligence/scripts/run-current-release.js

# Retire temporary/historical write machinery from the canonical branch.
rm -f .github/workflows/investor-control-market-intelligence-canonicalize-once.yml
rm -f .github/workflows/investor-control-market-intelligence-materialization-audit.yml
rm -f .github/workflows/apply-investor-control-ux-hotfix.yml
rm -f .github/workflows/investor-control-market-intelligence-canonical-commit.yml
rm -f .github/scripts/canonicalize-market-intelligence-source.sh

git fetch origin "$BRANCH"
LATEST_REMOTE="$(git rev-parse "origin/$BRANCH")"
if [[ "$LATEST_REMOTE" != "$BASE_SHA" ]]; then
  echo "Branch moved during canonicalization: trigger=$BASE_SHA remote=$LATEST_REMOTE" >&2
  exit 1
fi

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add -A market-intelligence .github/workflows .github/scripts
git status --short
if git diff --cached --quiet; then
  echo 'No canonicalization changes staged.' >&2
  exit 1
fi
git commit -m 'refactor(core): materialize canonical market intelligence source'
git push origin HEAD:"$BRANCH"

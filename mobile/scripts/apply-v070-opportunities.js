const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v0.7.0 patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchPortfolio() {
  let source = read('PortfolioApp.js');
  source = replaceRequired(
    source,
    "import { exportBackupAsync, pickBackupAsync } from './src/backup';\n",
    "import { exportBackupAsync, pickBackupAsync } from './src/backup';\nimport OpportunitiesView from './src/OpportunitiesView';\n",
    'OpportunitiesView import',
  );
  source = replaceRequired(source, "const VERSION = '0.6.5';", "const VERSION = '0.7.0';", 'PortfolioApp version');
  source = replaceRequired(
    source,
    "        {tab === 'settings' ? <>",
    "        {tab === 'opportunities' ? <OpportunitiesView /> : null}\n        {tab === 'settings' ? <>",
    'Opportunities tab content',
  );
  source = replaceRequired(
    source,
    "[['summary', '⌂', 'Σύνοψη'], ['transactions', '⇄', 'Συναλλαγές'], ['alerts', '!', 'Ειδοπ.'], ['settings', '⚙', 'Ρυθμίσεις']]",
    "[['summary', '⌂', 'Σύνοψη'], ['transactions', '⇄', 'Συναλλαγές'], ['opportunities', '◎', 'Έρευνα'], ['alerts', '!', 'Ειδοπ.'], ['settings', '⚙', 'Ρυθμίσεις']]",
    'five-item bottom navigation',
  );
  write('PortfolioApp.js', source);
}

function patchDecisionOverlayVersion() {
  let source = read('DecisionOverlay.js');
  source = replaceRequired(source, "const VERSION = '0.6.5';", "const VERSION = '0.7.0';", 'DecisionOverlay version');
  write('DecisionOverlay.js', source);
}

function patchJsonFiles() {
  const appJsonPath = path.join(root, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  appJson.expo.version = '0.7.0';
  appJson.expo.android.versionCode = 14;
  appJson.expo.ios.buildNumber = '14';
  fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  packageJson.version = '0.7.0';
  packageJson.scripts = packageJson.scripts || {};
  packageJson.scripts.postinstall = 'node scripts/apply-v065-native-ui-fix.js && node scripts/apply-v070-opportunities.js';
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

patchPortfolio();
patchDecisionOverlayVersion();
patchJsonFiles();

const portfolio = read('PortfolioApp.js');
if (!portfolio.includes("import OpportunitiesView from './src/OpportunitiesView';")) throw new Error('v0.7.0 patch verification failed: import missing');
if (!portfolio.includes("tab === 'opportunities'")) throw new Error('v0.7.0 patch verification failed: tab missing');
if (!portfolio.includes("['opportunities', '◎', 'Έρευνα']")) throw new Error('v0.7.0 patch verification failed: navigation missing');
if (!portfolio.includes("const VERSION = '0.7.0';")) throw new Error('v0.7.0 patch verification failed: version missing');

console.log('Investor Control v0.7.0 Opportunities patch applied.');

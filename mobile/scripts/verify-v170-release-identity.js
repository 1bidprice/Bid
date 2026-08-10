const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const expectedVersion = '1.7.0';
const expectedVersionCode = 28;
const expectedPackage = 'gr.investorcontrol.app';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageJson = JSON.parse(read('package.json'));
const app = JSON.parse(read('app.json'));
const portfolio = read('PortfolioApp.js');
const decision = read('DecisionOverlay.js');

assert(packageJson.version === expectedVersion, `package.json version mismatch: ${packageJson.version}`);
assert(app.expo?.version === expectedVersion, `app version mismatch: ${app.expo?.version}`);
assert(app.expo?.android?.package === expectedPackage, `Android package mismatch: ${app.expo?.android?.package}`);
assert(Number(app.expo?.android?.versionCode) === expectedVersionCode, `Android versionCode mismatch: ${app.expo?.android?.versionCode}`);
assert(app.expo?.android?.allowBackup === false, 'Android allowBackup must remain false');
assert(app.expo?.ios?.bundleIdentifier === expectedPackage, `iOS bundle mismatch: ${app.expo?.ios?.bundleIdentifier}`);
assert(String(app.expo?.ios?.buildNumber) === String(expectedVersionCode), `iOS buildNumber mismatch: ${app.expo?.ios?.buildNumber}`);
assert(portfolio.includes(`const VERSION = '${expectedVersion}';`), 'Portfolio UI version is not v1.7.0');
assert(decision.includes(`const VERSION = '${expectedVersion}';`), 'Decision UI version is not v1.7.0');
assert(portfolio.includes('schemaVersion: 5'), 'Portfolio storage schema changed unexpectedly');
assert(portfolio.includes('transactions: []'), 'Portfolio transaction state contract changed unexpectedly');
assert(packageJson.scripts?.['test:hunter-ui'], 'Hunter UI verifier missing');

console.log(JSON.stringify({
  releaseIdentity: 'PASS',
  version: expectedVersion,
  androidVersionCode: expectedVersionCode,
  packageId: expectedPackage,
  storageSchemaPreserved: true,
}, null, 2));

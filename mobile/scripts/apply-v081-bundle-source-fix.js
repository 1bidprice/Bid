const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const portfolioPath = path.join(root, 'PortfolioApp.js');
let source = fs.readFileSync(portfolioPath, 'utf8');

const broken = "item.quote?.updatedAt ? '" + '\n' + "Τιμή: ' +";
const fixed = "item.quote?.updatedAt ? ' · Τιμή: ' +";

if (source.includes(broken)) source = source.replace(broken, fixed);
if (source.includes("item.quote?.updatedAt ? '\nΤιμή: ' +")) {
  source = source.replace("item.quote?.updatedAt ? '\nΤιμή: ' +", fixed);
}
if (!source.includes(fixed)) throw new Error('v0.8.1 bundle fix failed: quote source expression not found');
fs.writeFileSync(portfolioPath, source);

const packagePath = path.join(root, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
packageJson.scripts = packageJson.scripts || {};
packageJson.scripts.postinstall = 'node scripts/apply-v065-native-ui-fix.js && node scripts/apply-v070-opportunities.js && node scripts/apply-v071-live-sync.js && node scripts/apply-v080-autonomous-decisions.js && node scripts/apply-v081-position-performance.js && node scripts/apply-v081-bundle-source-fix.js';
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log('Investor Control v0.8.1 bundle-safe source text fix applied.');

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const filePath = path.join(root, 'PortfolioApp.js');
let source = fs.readFileSync(filePath, 'utf8');

const broken = "item.quote?.updatedAt ? '\nΤιμή: '";
const fixed = "item.quote?.updatedAt ? '\\nΤιμή: '";

if (source.includes(broken)) {
  source = source.replace(broken, fixed);
}

if (!source.includes(fixed)) {
  throw new Error('v0.8.1b fix failed: source timestamp newline was not normalized');
}

fs.writeFileSync(filePath, source);

const packagePath = path.join(root, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
packageJson.scripts = packageJson.scripts || {};
packageJson.scripts.postinstall = 'node scripts/apply-v065-native-ui-fix.js && node scripts/apply-v070-opportunities.js && node scripts/apply-v071-live-sync.js && node scripts/apply-v080-autonomous-decisions.js && node scripts/apply-v081-position-performance.js && node scripts/apply-v081b-fix-source-newline.js';
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log('Investor Control v0.8.1 generated-source newline fixed and postinstall chain preserved.');

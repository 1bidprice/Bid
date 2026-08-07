const fs = require('fs');
const path = require('path');

const packagePath = path.resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.version = '1.2.3';
pkg.scripts = pkg.scripts || {};
const command = String(pkg.scripts.postinstall || '').trim();
if (!command.includes('apply-v123-actionable-plan.js')) {
  pkg.scripts.postinstall = `${command}${command ? ' && ' : ''}node scripts/apply-v123-actionable-plan.js`;
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

require('./apply-v124-actionable-release.js');

const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '..', 'PortfolioApp.js');
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
console.log('Investor Control v0.8.1 generated-source newline fixed.');

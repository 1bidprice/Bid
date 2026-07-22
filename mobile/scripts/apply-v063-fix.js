'use strict';

const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '..');

function replaceRequired(relativePath, oldText, newText, label) {
  const filePath = path.join(mobileRoot, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');

  if (source.includes(newText)) {
    console.log(`PASS ${label}: already applied`);
    return;
  }

  if (!source.includes(oldText)) {
    throw new Error(`Patch blocked: ${label} pattern not found in ${relativePath}`);
  }

  fs.writeFileSync(filePath, source.replace(oldText, newText), 'utf8');
  console.log(`APPLY ${label}`);
}

replaceRequired(
  'src/market-data.js',
  `      const changeBase = ['pre-market', 'post-market'].includes(point.session) && finite(regularMarketPrice)\n        ? regularMarketPrice\n        : previousClose;`,
  `      const changeBase = point.session === 'post-market' && finite(regularMarketPrice)\n        ? regularMarketPrice\n        : previousClose;`,
  'premarket daily change uses previous close',
);

replaceRequired(
  'src/market-data.js',
  'InvestorControl/0.6.2',
  'InvestorControl/0.6.3',
  'market-data version',
);

replaceRequired(
  'PortfolioApp.js',
  "const VERSION = '0.6.1';",
  "const VERSION = '0.6.3';",
  'portfolio version',
);

replaceRequired(
  'DecisionOverlay.js',
  "const VERSION = '0.6.1';",
  "const VERSION = '0.6.3';",
  'decision gate version',
);

const marketSource = fs.readFileSync(path.join(mobileRoot, 'src/market-data.js'), 'utf8');
if (!marketSource.includes("point.session === 'post-market' && finite(regularMarketPrice)")) {
  throw new Error('Verification failed: corrected session base is absent.');
}
if (marketSource.includes("['pre-market', 'post-market'].includes(point.session)")) {
  throw new Error('Verification failed: obsolete premarket comparison remains.');
}

const premarketPct = ((2.58 - 2.46) / 2.46) * 100;
const postmarketPct = ((2.60 - 2.57) / 2.57) * 100;
if (premarketPct.toFixed(2) !== '4.88') {
  throw new Error(`Premarket calculation test failed: ${premarketPct}`);
}
if (postmarketPct.toFixed(2) !== '1.17') {
  throw new Error(`Postmarket calculation test failed: ${postmarketPct}`);
}

console.log('PASS Investor Control v0.6.3 market-session percentage integrity.');

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'App.js');
let source = fs.readFileSync(appPath, 'utf8');

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v0.9.0 background patch failed: missing ${label}`);
  return content.replace(from, to);
}

source = replaceRequired(
  source,
  "import React, { useState } from 'react';",
  "import React, { useEffect, useState } from 'react';",
  'React hooks import',
);
source = replaceRequired(
  source,
  "import DecisionOverlay from './DecisionOverlay';",
  "import DecisionOverlay from './DecisionOverlay';\nimport { syncBackgroundIntelligenceTask } from './src/background-intelligence-task';",
  'background task import',
);
source = replaceRequired(
  source,
  "  const [decisionVisible, setDecisionVisible] = useState(false);\n  return (",
  "  const [decisionVisible, setDecisionVisible] = useState(false);\n  useEffect(() => {\n    syncBackgroundIntelligenceTask(true).catch((error) => {\n      console.warn('Investor Control background intelligence registration failed', error);\n    });\n  }, []);\n  return (",
  'background task registration',
);

fs.writeFileSync(appPath, source);

const packagePath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.version = '0.9.0';
pkg.scripts = pkg.scripts || {};
if (!String(pkg.scripts.postinstall || '').includes('apply-v090b-background-intelligence.js')) {
  pkg.scripts.postinstall = `${String(pkg.scripts.postinstall || '').trim()} && node scripts/apply-v090b-background-intelligence.js`.replace(/^\s*&&\s*/, '');
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

if (!source.includes('syncBackgroundIntelligenceTask(true)')) throw new Error('v0.9.0 background verification failed');
if (!pkg.scripts.postinstall.includes('apply-v090b-background-intelligence.js')) throw new Error('v0.9.0 postinstall verification failed');
console.log('Investor Control v0.9.0 background intelligence patch applied.');

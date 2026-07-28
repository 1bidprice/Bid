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

if (!source.includes('syncBackgroundIntelligenceTask(true)')) throw new Error('v0.9.0 background verification failed');
console.log('Investor Control v0.9.0 background intelligence patch applied.');

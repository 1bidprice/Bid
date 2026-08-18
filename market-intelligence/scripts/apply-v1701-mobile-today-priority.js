import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src', 'mobile-intelligence-feed.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, marker, label) {
  if (source.includes(marker)) return;
  if (!source.includes(from)) throw new Error(`v1.7.0 today-priority patch failed: missing ${label}`);
  source = source.replace(from, to);
}

replaceRequired(
  "  const decisions = dossiers.filter((item) => item.finalAction?.status === 'FINAL');\n  const urgent = dossiers.filter((item) => item.finalAction?.urgency === 'IMMEDIATE' || ['EVENT_RISK', 'DETERIORATION'].includes(item.category)).slice(0, 5);",
  "  const decisions = dossiers.filter((item) => item.finalAction?.status === 'FINAL');\n  const sellNowDecisions = decisions.filter((item) => item.finalAction?.marketAction === 'SELL_NOW');\n  const buyNowDecisions = decisions.filter((item) => item.finalAction?.marketAction === 'BUY_NOW');\n  const avoidDecisions = decisions.filter((item) => item.finalAction?.marketAction === 'AVOID');\n  const urgent = dossiers.filter((item) => item.finalAction?.urgency === 'IMMEDIATE' || ['EVENT_RISK', 'DETERIORATION'].includes(item.category)).slice(0, 5);",
  'const buyNowDecisions = decisions.filter',
  'final decision priority lanes',
);

replaceRequired(
  "      primaryItem: confirmedBuyOpportunities[0] || waitingEntryOpportunities[0] || urgent[0] || decisions[0] || reviewReady[0] || research[0] || null,",
  "      primaryItem: confirmedBuyOpportunities[0] || sellNowDecisions[0] || buyNowDecisions[0] || waitingEntryOpportunities[0] || avoidDecisions[0] || urgent[0] || decisions[0] || reviewReady[0] || research[0] || null,",
  'sellNowDecisions[0] || buyNowDecisions[0] || waitingEntryOpportunities[0]',
  'today primary-item priority alignment',
);

fs.writeFileSync(filePath, source);

const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  "const sellNowDecisions = decisions.filter",
  "const buyNowDecisions = decisions.filter",
  "const avoidDecisions = decisions.filter",
  "confirmedBuyOpportunities[0] || sellNowDecisions[0] || buyNowDecisions[0] || waitingEntryOpportunities[0]",
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.7.0 today-priority verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.7.0 mobile today headline/primary decision priority aligned.');
